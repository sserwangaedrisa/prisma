import prisma from "../../prisma/config";
import type { Request, Response } from "express";
import { validateUser, validateMonthNotLocked } from "../middleware/validation";
import { Prisma } from "../../prisma/generated/client";

interface worker {
  id: string;
  status: string;
  isActive: boolean;
  name: string;
  job: string;
  email: string;
  role: string;
  wageRatings: number | null;
  imageUrl: string | null;
}

export const singleWorkerPayment = async (req: Request, res: Response) => {
  try {
    const { workerId, siteId, startDate, endDate } = req.body;

    if (!siteId || !startDate || !endDate) {
      return res.status(200).json({
        message: "Missing required parameters: siteId, startDate, endDate",
        success: false,
      });
    }

    const workerData = await validateUser(workerId);
    if (!workerData || !workerData.success) {
      return res.status(200).json({
        success: false,
        message: workerData.message,
      });
    }

    const worker: worker = workerData.data as worker;
    const wageRating = worker?.wageRatings || 0;

    const start = new Date(startDate);
    const end = new Date(endDate);

    //  Enforce max 1 month range
    const diffInMs = end.getTime() - start.getTime();
    const diffInDays = diffInMs / (1000 * 60 * 60 * 24);

    if (diffInDays > 31) {
      return res.status(400).json({
        success: false,
        message: "Date range should not exceed one month",
      });
    }

    // checking for the closed month
    const monthClose = await prisma.monthClose.findFirst({
      where: {
        siteId: siteId,
        month: start.getMonth() + 1,
        year: start.getFullYear(),
      },
    });

    if (monthClose && monthClose.status === "LOCKED") {
      return res.status(403).json({
        success: false,
        message: "locked month",
        status: "locked month",
      });
    }

    const workEntries = await prisma.workEntry.findMany({
      where: {
        workerId: workerId,
        siteId: siteId,
        date: {
          gte: start,
          lte: end,
        },
      },
      orderBy: {
        date: "asc",
      },
      take: 31,
    });

    const aggregateData = await prisma.workEntry.aggregate({
      where: {
        workerId: workerId,
        siteId: siteId,
        status: {
          not: "PAID",
        },
        date: {
          gte: start,
          lte: end,
        },
      },
      _sum: {
        hours: true,
        overtime: true,
      },
      _count: {
        id: true,
      },
    });

    const totalRegularHours = aggregateData._sum.hours || 0;
    const totalOvertimeHours = aggregateData._sum.overtime || 0;
    const totalHours = totalRegularHours + totalOvertimeHours;
    const entryCount = aggregateData._count.id;

    if (entryCount === 0) {
      return res.status(200).json({
        workerId,
        siteId,
        period: { startDate, endDate },
        hasEntries: false,
        message: "No work entries found for this period",
      });
    }

    const totalAmount = totalHours * wageRating;

    const response = {
      worker: {
        id: worker?.id,
        name: worker?.name,
        email: worker?.email,
        wageRating: wageRating,
        role: worker?.role,
        job: worker?.job,
        imageUrl: worker?.imageUrl,
      },
      site: {
        id: siteId,
        name: "",
      },
      period: {
        startDate,
        endDate,
      },
      calculation: {
        formula: `Total Amount = (Total Hours + Overtime) × Wage Rating`,
        wageRating: wageRating,
        ratePerHour: wageRating,
      },
      summary: {
        totalRegularHours: Number(totalRegularHours.toFixed(2)),
        totalOvertimeHours: Number(totalOvertimeHours.toFixed(2)),
        totalHours: Number(totalHours.toFixed(2)),
        totalAmount: Number(totalAmount.toFixed(2)),
      },
      metadata: {
        entryCount: entryCount,
      },
      entries: workEntries,
    };

    return res.status(200).json({
      data: response,
      success: true,
      message: "entries retrieved successfully",
    });
  } catch (error) {
    console.error("Payment calculation error:", error);
    return res.status(500).json({
      message: "Failed to calculate payment",
      status: 500,
    });
  }
};

// payment request processing for the an individual

export const singleWorkerPaymentRequest = async (
  req: Request,
  res: Response,
) => {
  const { siteId, workerId, entryIds } = req.body;
  try {
    const userId = req.user.id;

    if (!siteId || !workerId || !entryIds) {
      res.status(200).json({
        success: false,
        message: "Some feilds missing",
      });
      return;
    }

    const workerData = await validateUser(workerId);
    if (!workerData.success) {
      res.status(200).json({
        message: workerData.message,
        success: false,
      });
    }

    const baseHourlyRate = workerData.data?.wageRatings ?? 0;

    const totals = await prisma.workEntry.aggregate({
      where: {
        id: { in: entryIds },
        status: "NOT_PAID",
      },

      _sum: {
        hours: true,
        overtime: true,
      },
    });

    const totalHours = totals._sum.hours ?? 0;
    const totalOvertime = totals._sum.overtime ?? 0;

    const baseAmount = totalHours * baseHourlyRate;
    const overtimePay = totalOvertime * baseHourlyRate;
    const totalAmount = baseAmount + overtimePay;

    if (totalAmount <= 0) {
      res.status(200).json({
        success: false,
        message: "Entries are already paid",
      });
      return;
    }

    const payment = await prisma.payment.create({
      data: {
        workerId,
        siteId,
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
        totalHours,
        overtime: totalOvertime,
        baseAmount,
        overtimePay,
        totalAmount,
        status: "PENDING",
      },
    });

    const entryUpdate = await prisma.workEntry.updateMany({
      where: {
        id: { in: entryIds },
      },
      data: {
        paymentId: payment.id,
        status: "PENDING",
      },
    });

    if (entryUpdate.count === 0) {
      return res.status(400).json({
        success: false,
        message: "Failed to finish the request proccessing.",
      });
    }

    await prisma.activityLog.create({
      data: {
        userId,
        action: "Payment Request",
        entity: "PAYMENT",
        entityId: payment.id,
      },
    });

    res.status(200).json({
      data: {
        workerId,
        siteId,
        totalHours,
        overtime: totalOvertime,
        baseAmount,
        overtimePay,
        totalAmount,
        status: "PENDING",
      },
      success: true,
      message: "Payment request submitted successfully",
    });
  } catch (error) {
    console.log("error while getting payments");
    return res.status(500).json({
      success: false,
    });
  }
};

// payment for the whole site for a specific date range using nodeJs in the server ram

// export const sitePayment = async (req: Request, res: Response) => {
//   const { siteId, startDate, endDate } = req.body;

//   try {
//     if (!startDate || !endDate) {
//       return res.status(200).json({
//         message: "Missing required parameters: startDate, endDate",
//         success: false,
//       });
//     }

//     const start = new Date(startDate);
//     const end = new Date(endDate);

//     const monthValidation = await validateMonthNotLocked(siteId, start);
//     if (!monthValidation.success) {
//       return res.status(200).json({
//         message: monthValidation.message,
//         success: false,
//       });
//     }

//     // Get all work entries with worker details
//     const workEntries = await prisma.workEntry.findMany({
//       where: {
//         siteId: siteId,
//         status: "NOT_PAID",
//         date: {
//           gte: start,
//           lte: end,
//         },
//       },
//       select: {
//         id: true,
//         date: true,
//         hours: true,
//         overtime: true,
//         worker: {
//           select: {
//             id: true,
//             name: true,
//             wageRating: true,
//             role: true,
//             job: true,
//             isActive: true,
//           },
//         },
//         site: {
//           select: {
//             id: true,
//             name: true,
//           },
//         },
//       },
//       orderBy: [{ worker: { name: "asc" } }, { date: "asc" }],
//     });

//     if (workEntries.length === 0) {
//       return res.status(200).json({
//         siteId,
//         period: { startDate, endDate },
//         workers: [],
//         message: "No work entries found for this period",
//       });
//     }

//     // Group by worker and calculate totals
//     const workersMap = new Map();

//     for (const entry of workEntries) {
//       const workerId = entry.worker.id;
//       const wageRating = entry.worker.wageRating || 0;
//       const totalHoursForEntry = entry.hours + entry.overtime;
//       const entryAmount = totalHoursForEntry * wageRating;

//       if (!workersMap.has(workerId)) {
//         workersMap.set(workerId, {
//           worker: {
//             id: entry.worker.id,
//             name: entry.worker.name,
//             wageRating: wageRating,
//             role: entry.worker.role,
//             job: entry.worker.job,
//             isActive: entry.worker.isActive,
//           },
//           regularHours: 0,
//           overtimeHours: 0,
//           totalHours: 0,
//           totalAmount: 0,
//           entries: [],
//           entryCount: 0,
//         });
//       }

//       const workerData = workersMap.get(workerId);
//       workerData.regularHours += entry.hours;
//       workerData.overtimeHours += entry.overtime;
//       workerData.totalHours += totalHoursForEntry;
//       workerData.totalAmount += entryAmount;
//       workerData.entryCount++;
//       workerData.entries.push({
//         id: entry.id,
//         date: entry.date,
//         hours: entry.hours,
//         overtime: entry.overtime,
//         totalHours: totalHoursForEntry,
//         amount: Number(entryAmount.toFixed(2)),
//       });
//     }

//     // Convert map to array and format
//     const workers = Array.from(workersMap.values()).map((worker) => ({
//       ...worker,
//       regularHours: Number(worker.regularHours.toFixed(2)),
//       overtimeHours: Number(worker.overtimeHours.toFixed(2)),
//       totalHours: Number(worker.totalHours.toFixed(2)),
//       totalAmount: Number(worker.totalAmount.toFixed(2)),
//     }));

//     // Sort by total amount (highest first)
//     workers.sort((a, b) => b.totalAmount - a.totalAmount);

//     const siteTotal = workers.reduce(
//       (sum, worker) => sum + worker.totalAmount,
//       0,
//     );
//     const totalSiteHours = workers.reduce(
//       (sum, worker) => sum + worker.totalHours,
//       0,
//     );

//     return res.status(200).json({
//       success: true,
//       site: {
//         id: siteId,
//       },
//       period: {
//         startDate,
//         endDate,
//       },
//       calculation: {
//         formula: `Total Amount = (Regular Hours + Overtime) × Worker's Wage Rating`,
//         description:
//           "Each worker's total is calculated independently based on their individual wage rating",
//       },
//       summary: {
//         totalWorkers: workers.length,
//         totalEntries: workEntries.length,
//         totalHours: Number(totalSiteHours.toFixed(2)),
//         totalAmount: Number(siteTotal.toFixed(2)),
//       },
//       workers,
//     });
//   } catch (error) {
//     console.error("Site payment calculation error:", error);
//     return res
//       .status(500)
//       .json({ message: "Failed to calculate site payments", success: false });
//   }
// };

// payment for the whole site for a specific date range using raw quering in db. for more calculations

export const sitePaymentSummary = async (req: Request, res: Response) => {
  const { siteId, startDate, endDate } = req.body;

  try {
    if (!startDate || !endDate) {
      return res.status(200).json({
        message: "Missing required parameters: startDate, endDate",
        success: false,
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Checking if the month is locked to prevent payments on locked periods
    const monthValidation = await validateMonthNotLocked(siteId, start);
    if (!monthValidation.success) {
      return res.status(200).json({
        message: monthValidation.message,
        success: false,
      });
    }

    const result = await prisma.$queryRaw`
      SELECT 
        w.id as worker_id,
        w.name as worker_name,
        w."wageRating" as wage_rating,
        w.role as worker_role,
        w.job as worker_job,
        w."isActive" as worker_is_active,
        
        COALESCE(SUM(we.hours), 0) as total_regular_hours,
        COALESCE(SUM(we.overtime), 0) as total_overtime_hours,
        COALESCE(SUM(we.hours + we.overtime), 0) as total_hours,
        COALESCE(SUM((we.hours + we.overtime) * COALESCE(w."wageRating", 0)), 0) as total_amount,
        COUNT(we.id) as entry_count,

        -- Building the json response
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', we.id,
              'date', we.date,
              'hours', we.hours,
              'overtime', we.overtime,
              'totalHours', we.hours + we.overtime,
              'amount', (we.hours + we.overtime) * COALESCE(w."wageRating", 0)
            ) ORDER BY we.date ASC
          ) FILTER (WHERE we.id IS NOT NULL),
          '[]'::json
        ) as entries
        
      FROM "WorkEntry" we
      
      -- Joining User table to get worker details and wage rating
      INNER JOIN "User" w ON we."workerId" = w.id
      
      WHERE 
        we."siteId" = ${siteId}
        AND we.status = 'NOT_PAID'
        AND we.date BETWEEN ${start} AND ${end} 
        AND w."isActive" = true
      
      GROUP BY 
        w.id, 
        w.name, 
        w."wageRating", 
        w.job, 
        w."isActive"
      
      ORDER BY 
        COALESCE(SUM((we.hours + we.overtime) * COALESCE(w."wageRating", 0)), 0) DESC
    `;

    // Handle case when no work entries found
    if (!result || (Array.isArray(result) && result.length === 0)) {
      return res.status(200).json({
        success: false,
        siteId,
        period: { startDate, endDate },
        workers: [],
        message: "No work entries found for this period",
      });
    }

    const workers = (result as any[]).map((worker) => ({
      worker: {
        id: worker.worker_id,
        name: worker.worker_name,
        wageRating: Number(worker.wage_rating) || 0,
        job: worker.worker_job,
      },

      regularHours: Number(Number(worker.total_regular_hours).toFixed(2)),
      overtimeHours: Number(Number(worker.total_overtime_hours).toFixed(2)),
      totalHours: Number(Number(worker.total_hours).toFixed(2)),

      // Total payment amount for this worker
      totalAmount: Number(Number(worker.total_amount).toFixed(2)),

      entryCount: Number(worker.entry_count),
    }));

    // Calculating site-level aggregates from worker data
    const totalSiteHours = workers.reduce((sum, w) => sum + w.totalHours, 0);
    const siteTotal = workers.reduce((sum, w) => sum + w.totalAmount, 0);
    const totalEntries = workers.reduce((sum, w) => sum + w.entryCount, 0);

    // Return formatted response
    return res.status(200).json({
      success: true,
      site: {
        id: siteId,
      },
      period: {
        startDate,
        endDate,
      },
      calculation: {
        formula: `Total Amount = (Regular Hours + Overtime) * Worker's Wage Rating`,
        description:
          "Each worker's total is calculated independently based on their individual wage rating. " +
          "Wage rating is stored per worker in the User table.",
      },
      summary: {
        totalWorkers: workers.length,
        totalEntries: totalEntries,
        totalHours: Number(totalSiteHours.toFixed(2)),
        totalAmount: Number(siteTotal.toFixed(2)),
      },
      workers,
    });
  } catch (error) {
    console.error("Site payment calculation error:", error);

    return res.status(500).json({
      message: "Failed to calculate site payments",
      success: false,
    });
  }
};

// Create payment requests with batch ID
export const sitePaymentRequest = async (req: Request, res: Response) => {
  const { siteId, startDate, endDate } = req.body;

  try {
    if (!startDate || !endDate) {
      return res.status(200).json({
        message: "Missing required parameters: startDate, endDate",
        success: false,
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const month = start.getMonth() + 1;
    const year = start.getFullYear();
    const overtimeRate = 1.5;
    const batchId = crypto.randomUUID(); // Generate unique batch ID

    // Check if month is locked
    const monthValidation = await validateMonthNotLocked(siteId, start);
    if (!monthValidation.success) {
      return res.status(200).json({
        message: monthValidation.message,
        success: false,
      });
    }

    // Get worker summary
    const workers = await prisma.$queryRaw<
      Array<{
        worker_id: string;
        wage_rating: number;
        total_regular_hours: number;
        total_overtime_hours: number;
        total_hours: number;
        work_entry_ids: string[];
      }>
    >`
      SELECT 
        w.id as worker_id,
        w."wageRating" as wage_rating,
        COALESCE(SUM(we.hours), 0) as total_regular_hours,
        COALESCE(SUM(we.overtime), 0) as total_overtime_hours,
        COALESCE(SUM(we.hours + we.overtime), 0) as total_hours,
        ARRAY_AGG(we.id) as work_entry_ids
      FROM "WorkEntry" we
      INNER JOIN "User" w ON we."workerId" = w.id
      WHERE 
        we."siteId"::text = ${siteId}
        AND we.status = 'NOT_PAID'
        AND we.date BETWEEN ${start} AND ${end}
        AND w."isActive" = true
      GROUP BY w.id, w."wageRating"
      HAVING COALESCE(SUM(we.hours + we.overtime), 0) > 0
    `;

    if (!workers || workers.length === 0) {
      return res.status(200).json({
        success: false,
        message: "No work entries found for this period",
      });
    }

    const paymentIds: string[] = [];

    for (const worker of workers) {
      const baseAmount = worker.total_regular_hours * worker.wage_rating;
      const overtimePay =
        worker.total_overtime_hours * worker.wage_rating * overtimeRate;
      const totalAmount = baseAmount + overtimePay;

      const result = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "Payment" (
          id, "workerId", "siteId", month, year,
          "totalHours", overtime, "baseAmount", "overtimePay",
          "totalAmount", status, "batch_id", "createdAt"
        )
        VALUES (
          gen_random_uuid(),
          ${worker.worker_id}::uuid,
          ${siteId}::uuid,
          ${month},
          ${year},
          ${worker.total_hours},
          ${worker.total_overtime_hours},
          ${baseAmount},
          ${overtimePay},
          ${totalAmount},
          'PENDING'::"PaymentStatus",
          ${batchId}::uuid,
          NOW()
        )
        RETURNING id
      `;

      if (result && result[0]) {
        paymentIds.push(result[0].id);

        // Update work entries for this worker
        if (worker.work_entry_ids.length > 0) {
          await prisma.$executeRaw`
            UPDATE "WorkEntry"
            SET 
              "paymentId" = ${result[0].id}::uuid,
              status = 'PENDING'::"WorkEntryStatus"
            WHERE id::text = ANY(${worker.work_entry_ids}::text[])
          `;
        }
      }
    }

    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: "Created batch payment request",
        entity: "PAYMENT",
        entityId: batchId,
      },
    });

    return res.status(200).json({
      success: true,
      batchId: batchId,
      message: `Successfully created payment requests for ${workers.length} workers`,
    });
  } catch (error) {
    console.error("Site payment calculation error:", error);
    return res.status(500).json({
      message: "Failed to calculate site payments",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Approve a specific batch of payments
export const approvePaymentBatch = async (req: Request, res: Response) => {
  const { batchId } = req.params;
  const { foremanId } = req.body;

  try {
    const result = await prisma.$queryRaw<
      Array<{
        updated_payments: number;
        updated_entries: number;
        total_amount: number;
      }>
    >`
      WITH updated_payments AS (
        UPDATE "Payment"
        SET 
          status = 'APPROVED'::"PaymentStatus",
          "approvedAt" = NOW()
        WHERE 
          "batchId" = ${batchId}::uuid
          AND status = 'PENDING'::"PaymentStatus"
        RETURNING id, "totalAmount"
      ),
      updated_entries AS (
        UPDATE "WorkEntry"
        SET status = 'APPROVED'::"WorkEntryStatus"
        WHERE "paymentId" IN (SELECT id FROM updated_payments)
        RETURNING id
      )
      SELECT 
        (SELECT COUNT(*) FROM updated_payments) as updated_payments,
        (SELECT COUNT(*) FROM updated_entries) as updated_entries,
        COALESCE((SELECT SUM("totalAmount") FROM updated_payments), 0) as total_amount
    `;

    const summary = result[0];

    // Log activity
    if (foremanId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (gen_random_uuid(), ${foremanId}::uuid, 'APPROVE_BATCH', 'Payment', ${batchId}, NOW())
      `;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully approved ${summary.updated_payments} payments in batch ${batchId}`,
      summary: {
        approvedPayments: Number(summary.updated_payments),
        updatedEntries: Number(summary.updated_entries),
        totalAmount: Number(summary.total_amount.toFixed(2)),
      },
    });
  } catch (error) {
    console.error("Error approving payment batch:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to approve payment batch",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Mark a specific batch as paid
export const markBatchAsPaid = async (req: Request, res: Response) => {
  const { batchId } = req.params;
  const { ownerId, transactionReference } = req.body;

  try {
    const result = await prisma.$queryRaw<
      Array<{
        updated_payments: number;
        total_amount: number;
        updated_work_entries: number;
      }>
    >`
      WITH updated_payments AS (
        UPDATE "Payment"
        SET 
          status = 'PAID'::"PaymentStatus",
          "paidAt" = NOW()
        WHERE 
          "batchId" = ${batchId}::uuid
        RETURNING id, "totalAmount"
      ),
      updated_work_entries AS (
        UPDATE "WorkEntry"
        SET 
          status = 'PAID'::"WorkEntryStatus"
        WHERE 
          "paymentId" IN (SELECT id FROM updated_payments)
        RETURNING id
      )
      SELECT 
        (SELECT COUNT(*) FROM updated_payments) as updated_payments,
        COALESCE((SELECT SUM("totalAmount") FROM updated_payments), 0) as total_amount,
        (SELECT COUNT(*) FROM updated_work_entries) as updated_work_entries
    `;

    const summary = result[0];

    // Log activity
    if (ownerId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (gen_random_uuid(), ${ownerId}::uuid, 'PAY_BATCH', 'Payment', ${batchId}, NOW())
      `;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully marked ${summary.updated_payments} payments and ${summary.updated_work_entries} work entries as PAID`,
      summary: {
        paidPayments: Number(summary.updated_payments),
        totalAmount: Number(summary.total_amount.toFixed(2)),
        updatedWorkEntries: Number(summary.updated_work_entries),
        transactionReference: transactionReference || null,
      },
    });
  } catch (error) {
    console.error("Error marking batch as paid:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark payments as paid",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Send a batch back for review (e.g. if owner wants changes after approval, or foreman wants changes after request)

export const reviewPaymentBatch = async (req: Request, res: Response) => {
  const { batchId } = req.params;
  const { foremanId, reviewNotes } = req.body; // Optional review notes from owner

  try {
    const result = await prisma.$queryRaw<
      Array<{
        updated_payments: number;
        updated_entries: number;
        total_amount: number;
      }>
    >`
      WITH updated_payments AS (
        UPDATE "Payment"
        SET 
          status = 'REVIEW'::"PaymentStatus",
          "approvedAt" = NULL 
        WHERE 
          "batchId" = ${batchId}::uuid
          AND status = 'PENDING'::"PaymentStatus"  
        RETURNING id, "totalAmount"
      ),
      updated_entries AS (
        UPDATE "WorkEntry"
        SET status = 'REVIEW'::"WorkEntryStatus"
        WHERE "paymentId" IN (SELECT id FROM updated_payments)
        RETURNING id
      )
      SELECT 
        (SELECT COUNT(*) FROM updated_payments) as updated_payments,
        (SELECT COUNT(*) FROM updated_entries) as updated_entries,
        COALESCE((SELECT SUM("totalAmount") FROM updated_payments), 0) as total_amount
    `;

    const summary = result[0];

    // Log activity with review notes if provided
    if (foremanId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt", details)
        VALUES (
          gen_random_uuid(), 
          ${foremanId}::uuid, 
          'REVIEW_BATCH', 
          'Payment', 
          ${batchId}, 
          NOW(),
          ${reviewNotes || "Payment batch sent back for review"}
        )
      `;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully sent ${summary.updated_payments} payments back for review in batch ${batchId}`,
      summary: {
        reviewedPayments: Number(summary.updated_payments),
        updatedEntries: Number(summary.updated_entries),
        totalAmount: Number(summary.total_amount.toFixed(2)),
        reviewNotes: reviewNotes || null,
      },
    });
  } catch (error) {
    console.error("Error reviewing payment batch:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send payment batch for review",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Get all batches for a site (list of all payment requests)
export const getSiteBatches = async (req: Request, res: Response) => {
  const { siteId } = req.params;

  try {
    const batches = await prisma.$queryRaw<
      Array<{
        batch_id: string;
        created_at: Date;
        total_payments: number;
        total_amount: number;
        status: string;
        pending_count: number;
        approved_count: number;
        paid_count: number;
      }>
    >`
      SELECT 
        "batchId" as batch_id,
        MIN("createdAt") as created_at,
        COUNT(*) as total_payments,
        SUM("totalAmount") as total_amount,
        CASE 
          WHEN COUNT(*) FILTER (WHERE status = 'PAID') = COUNT(*) THEN 'PAID'
          WHEN COUNT(*) FILTER (WHERE status = 'APPROVED') > 0 THEN 'PARTIALLY_APPROVED'
          WHEN COUNT(*) FILTER (WHERE status = 'PENDING') = COUNT(*) THEN 'PENDING'
          ELSE 'MIXED'
        END as status,
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending_count,
        COUNT(*) FILTER (WHERE status = 'APPROVED') as approved_count,
        COUNT(*) FILTER (WHERE status = 'PAID') as paid_count
      FROM "Payment"
      WHERE "siteId" = ${siteId}::uuid
        AND "batchId" IS NOT NULL
      GROUP BY "batchId"
      ORDER BY MIN("createdAt") DESC
    `;

    return res.status(200).json({
      success: true,
      siteId,
      totalBatches: batches.length,
      batches: batches.map((b) => ({
        id: b.batch_id,
        createdAt: b.created_at,
        totalPayments: Number(b.total_payments),
        totalAmount: Number(b.total_amount.toFixed(2)),
        status: b.status,
        breakdown: {
          pending: Number(b.pending_count),
          approved: Number(b.approved_count),
          paid: Number(b.paid_count),
        },
      })),
    });
  } catch (error) {
    console.error("Error fetching batches:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch batches",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Get details of a specific batch
export const getBatchDetails = async (req: Request, res: Response) => {
  const { batchId } = req.params;

  try {
    const batchInfo = await prisma.$queryRaw<
      Array<{
        batch_id: string;
        created_at: Date;
        site_id: string;
        site_name: string;
        month: number;
        year: number;
        total_payments: number;
        total_amount: number;
        total_hours: number;
        pending_count: number;
        approved_count: number;
        paid_count: number;
      }>
    >`
      SELECT 
        p."batchId" as batch_id,
        MIN(p."createdAt") as created_at,
        p."siteId" as site_id,
        s.name as site_name,
        p.month,
        p.year,
        COUNT(*) as total_payments,
        SUM(p."totalAmount") as total_amount,
        SUM(p."totalHours") as total_hours,
        COUNT(*) FILTER (WHERE p.status = 'PENDING') as pending_count,
        COUNT(*) FILTER (WHERE p.status = 'APPROVED') as approved_count,
        COUNT(*) FILTER (WHERE p.status = 'PAID') as paid_count
      FROM "Payment" p
      INNER JOIN "Site" s ON p."siteId" = s.id
      WHERE p."batchId" = ${batchId}::uuid
      GROUP BY p."batchId", p."siteId", s.name, p.month, p.year
    `;

    if (!batchInfo || batchInfo.length === 0) {
      return res.status(200).json({
        success: false,
        message: "Batch not found",
      });
    }

    // Get individual payments in this batch
    const payments = await prisma.$queryRaw<
      Array<{
        id: string;
        worker_id: string;
        worker_name: string;
        total_hours: number;
        total_amount: number;
        status: string;
      }>
    >`
      SELECT 
        p.id,
        p."workerId" as worker_id,
        u.name as worker_name,
        p."totalHours" as total_hours,
        p."totalAmount" as total_amount,
        p.status
      FROM "Payment" p
      INNER JOIN "User" u ON p."workerId" = u.id
      WHERE p."batchId" = ${batchId}::uuid
      ORDER BY u.name
    `;

    const info = batchInfo[0];
    return res.status(200).json({
      success: true,
      batch: {
        id: info.batch_id,
        createdAt: info.created_at,
        site: {
          id: info.site_id,
          name: info.site_name,
        },
        period: {
          month: info.month,
          year: info.year,
        },
        summary: {
          totalPayments: Number(info.total_payments),
          totalHours: Number(info.total_hours.toFixed(2)),
          totalAmount: Number(info.total_amount.toFixed(2)),
          statusBreakdown: {
            pending: Number(info.pending_count),
            approved: Number(info.approved_count),
            paid: Number(info.paid_count),
          },
        },
        payments: payments.map((p) => ({
          id: p.id,
          workerId: p.worker_id,
          workerName: p.worker_name,
          totalHours: Number(p.total_hours),
          totalAmount: Number(p.total_amount),
          status: p.status,
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching batch details:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch batch details",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Cancel/Delete a batch (only if all payments are still PENDING)
export const cancelBatch = async (req: Request, res: Response) => {
  const { batchId } = req.params;
  const { userId } = req.body;

  try {
    // Check if any payments are already approved or paid
    const nonPending = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*) as count
      FROM "Payment"
      WHERE "batchId" = ${batchId}::uuid
        AND status != 'PENDING'::"PaymentStatus"
    `;

    if (nonPending[0]?.count > 0) {
      return res.status(200).json({
        success: false,
        message:
          "Cannot cancel batch. Some payments have already been approved or paid.",
      });
    }

    // Unlink work entries
    await prisma.$executeRaw`
      UPDATE "WorkEntry"
      SET 
        "paymentId" = NULL,
        status = 'NOT_PAID'::"WorkEntryStatus"
      WHERE "paymentId" IN (
        SELECT id FROM "Payment"
        WHERE "batchId" = ${batchId}::uuid
      )
    `;

    // Delete payments
    const result = await prisma.$executeRaw`
      DELETE FROM "Payment"
      WHERE "batchId" = ${batchId}::uuid
    `;

    // Log activity
    if (userId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (gen_random_uuid(), ${userId}::uuid, 'CANCEL_BATCH', 'Payment', ${batchId}, NOW())
      `;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully cancelled batch ${batchId}`,
      deletedCount: result,
    });
  } catch (error) {
    console.error("Error cancelling batch:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel batch",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
