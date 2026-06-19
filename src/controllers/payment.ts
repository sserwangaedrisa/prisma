import prisma from "../../prisma/config";
import type { Request, Response } from "express";
import { validateUser, validateMonthNotLocked } from "../middleware/validation";
import { PaymentStatus, Prisma } from "../../prisma/generated/client";

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

// Single workers details for the month.

export const singleWorkerPayment = async (req: Request, res: Response) => {
  try {
    const { workerId, siteId, startDate, endDate, paymentId } = req.body;

    if (!siteId || (!paymentId && (!startDate || !endDate))) {
      return res.status(200).json({
        message: "Missing required parameters",
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

    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    // Enforcing max 1 month only when no paymentId
    if (!paymentId && start && end) {
      const diffInMs = end.getTime() - start.getTime();
      const diffInDays = diffInMs / (1000 * 60 * 60 * 24);
      if (diffInDays > 31) {
        return res.status(400).json({
          success: false,
          message: "Date range should not exceed one month",
        });
      }
    }

    // Shared WHERE condition
    const whereCondition = {
      workerId,
      siteId,
      paymentId: paymentId || undefined,
      ...(paymentId
        ? {}
        : {
            date: {
              gte: start!,
              lte: end!,
            },
          }),
    };

    // Single groupBy query to get all per‑status sums
    const groupedStatus = await prisma.workEntry.groupBy({
      by: ["status"],
      where: whereCondition,
      _sum: {
        hours: true,
        overtime: true,
        amount: true,
      },
      _count: {
        id: true,
      },
    });

    // Initialize status summary with all possible statuses
    const statusSummary: any = {
      PENDING: { hours: 0, overtime: 0, total: 0, amount: 0, count: 0 },
      PAID: { hours: 0, overtime: 0, total: 0, amount: 0, count: 0 },
      REJECTED: { hours: 0, overtime: 0, total: 0, amount: 0, count: 0 },
      REVIEW: { hours: 0, overtime: 0, total: 0, amount: 0, count: 0 },
      NOT_PAID: { hours: 0, overtime: 0, total: 0, amount: 0, count: 0 },
      APPROVED: { hours: 0, overtime: 0, total: 0, amount: 0, count: 0 },
    };

    // Accumulate totals while populating statusSummary
    let totalRegularHours = 0;
    let totalOvertimeHours = 0;
    let totalAmount = 0;
    let entryCount = 0;

    for (const item of groupedStatus) {
      const hours = item._sum.hours || 0;
      const overtime = item._sum.overtime || 0;
      const total = hours + overtime;
      const amount = item._sum.amount || 0;
      const count = item._count.id;

      statusSummary[item.status] = {
        hours,
        overtime,
        total,
        amount,
        count,
      };

      // Adding to overall totals
      totalRegularHours += hours;
      totalOvertimeHours += overtime;
      totalAmount += amount;
      entryCount += count;
    }

    const totalHours = totalRegularHours + totalOvertimeHours;

    if (entryCount === 0) {
      return res.status(200).json({
        workerId,
        siteId,
        period: paymentId ? undefined : { startDate, endDate },
        hasEntries: false,
        message: "No work entries found for this period",
      });
    }

    // Detailed entries for frontend display (limited to 31 entries for pagination)
    const workEntries = await prisma.workEntry.findMany({
      where: whereCondition,
      orderBy: { date: "asc" },
      take: 31,
    });

    let paymentMonthStart = null;
    let paymentMonthEnd = null;
    if (paymentId && workEntries.length > 0) {
      const date = workEntries[0].date;
      paymentMonthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      paymentMonthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    }

    const response = {
      worker: {
        id: worker?.id,
        name: worker?.name,
        email: worker?.email,
        wageRating,
        role: worker?.role,
        job: worker?.job,
        imageUrl: worker?.imageUrl,
      },
      site: {
        id: siteId,
        name: "",
      },
      period: paymentId
        ? { startDate: paymentMonthStart, endDate: paymentMonthEnd }
        : { startDate, endDate },

      calculation: {
        formula: `Total Amount = Sum of precomputed entry amounts`,
        wageRating,
        ratePerHour: wageRating,
      },

      summary: {
        totalRegularHours: Number(totalRegularHours.toFixed(2)),
        totalOvertimeHours: Number(totalOvertimeHours.toFixed(2)),
        totalHours: Number(totalHours.toFixed(2)),
        totalAmount: Number(totalAmount.toFixed(2)),
        TOTALREGULARHOURS: Number(totalRegularHours.toFixed(2)),
        TOTALOVERTIMEHOURS: Number(totalOvertimeHours.toFixed(2)),
        TOTALHOURS: Number(totalHours.toFixed(2)),
        ENTRYCOUNT: entryCount,
      },

      statusSummary,

      metadata: {
        entryCount,
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
        message: "Some fields missing",
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
        amount: true,
      },
    });

    const totalHours = totals._sum.hours ?? 0;
    const totalOvertime = totals._sum.overtime ?? 0;
    const totalAmount = totals._sum.amount ?? 0;

    const baseAmount = totalHours * baseHourlyRate;
    const overtimePay = totalOvertime * baseHourlyRate;

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
      await prisma.payment.delete({
        where: { id: payment.id },
      });

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
  const userId = req.user.id;

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
        AND status NOT IN ('PAID'::"PaymentStatus", 'APPROVED'::"PaymentStatus")
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
    if (userId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (gen_random_uuid(), ${userId}::uuid, 'APPROVE_BATCH', 'Payment', ${batchId}, NOW())
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
          "batchId" = ${batchId}::text
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

// Send a batch back for review FROM THE FOREMAN TO THE OWNER

export const reviewPaymentBatch = async (req: Request, res: Response) => {
  const { batchId } = req.params;
  const { foremanId, reviewNotes } = req.body;
  const userId = req.user.id;

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
          "batchId" = ${batchId}::text
        AND status IN ('APPROVED'::"PaymentStatus", 'REJECTED'::"PaymentStatus")
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
    if (userId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (
          gen_random_uuid(), 
          ${userId}::uuid, 
          'REVIEW_BATCH', 
          'Payment', 
          ${batchId}, 
          NOW(),
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
        rejected_count: number;
        review_count: number;
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
          WHEN COUNT(*) FILTER (WHERE status = 'REJECTED') = COUNT(*) THEN 'REJECTED'
          WHEN COUNT(*) FILTER (WHERE status = 'REVIEW') = COUNT(*) THEN 'REVIEW'

          ELSE 'MIXED'
        END as status,
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending_count,
        COUNT(*) FILTER (WHERE status = 'APPROVED') as approved_count,
        COUNT(*) FILTER (WHERE status = 'PAID') as paid_count
        COUNT(*) FILTER (WHERE status = 'REJECTED') as rejected_count
        COUNT(*) FILTER (WHERE status = 'REVIEW') as review_count

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
          rejected: Number(b.rejected_count),
          review: Number(b.review_count),
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

// Cancel/Delete a batch
export const cancelBatch = async (req: Request, res: Response) => {
  const { batchId } = req.params;
  const { userId } = req.body;

  try {
    // Checking if any payments are already approved or paid
    const nonPending = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*) as count
      FROM "Payment"
      WHERE "batchId" = ${batchId}::text
        AND status not in  ('PENDING'::"PaymentStatus", 'REJECTED'::"PaymentStatus")
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
        "batchId" = NULL,
        status = 'NOT_PAID'::"WorkEntryStatus"
      WHERE "paymentId" IN (
        SELECT id FROM "Payment"
        WHERE "batchId" = ${batchId}::text
      )
    `;

    // Delete payments
    const result = await prisma.$executeRaw`
      DELETE FROM "Payment"
      WHERE "batchId" = ${batchId}::text
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

// Cancel/Delete a single payment request (only if still PENDING)
export const cancelSinglePayment = async (req: Request, res: Response) => {
  const { paymentId } = req.params;
  const userId = req.user.id;

  try {
    // Check if payment is already approved or paid
    const paymentStatus = await prisma.$queryRaw<Array<{ status: string }>>`
      SELECT status
      FROM "Payment"
      WHERE id = ${paymentId}::text
    `;

    if (
      !paymentStatus[0] ||
      paymentStatus[0].status === "APPROVED" ||
      paymentStatus[0].status === "PAID"
    ) {
      return res.status(200).json({
        success: false,
        message: "Cannot cancel payment. It has already been approved or paid.",
      });
    }

    // Unlink work entries
    await prisma.$executeRaw`
      UPDATE "WorkEntry"
      SET 
        "paymentId" = NULL,  
        status = 'NOT_PAID'::"WorkEntryStatus"
      WHERE "paymentId" = ${paymentId}::text
    `;

    // Delete payment
    const result = await prisma.$executeRaw`
      DELETE FROM "Payment"
      WHERE id = ${paymentId}::text
    `;

    // Log activity
    if (userId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (gen_random_uuid(), ${userId}::uuid, 'CANCEL_PAYMENT', 'Payment', ${paymentId}, ${new Date()})
      `;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully cancelled payment ${paymentId}`,
      deletedCount: result,
    });
  } catch (error) {
    console.error("Error cancelling payment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel payment",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Get all payments with pagination, filtering, sorting
export const getPayments = async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 10,
    sortField = "createdAt",
    sortOrder = "desc",
    status,
    siteId,
    batchId,
    startDate,
    endDate,
    search,
  } = req.query;

  try {
    const allowedSortFields = [
      "createdAt",
      "totalAmount",
      "status",
      "workerName",
      "siteName",
      "month",
      "year",
    ] as const;
    const validSortField = allowedSortFields.includes(sortField as any)
      ? (sortField as (typeof allowedSortFields)[number])
      : "createdAt";

    const validSortOrder =
      sortOrder === "asc" || sortOrder === "desc" ? sortOrder : "desc";

    let whereClause = "WHERE 1=1";
    const params: any[] = [];
    let paramIndex = 1;

    if (status && status !== "all") {
      whereClause += ` AND p.status = $${paramIndex}::"PaymentStatus"`;
      params.push(status);
      paramIndex++;
    }

    if (siteId) {
      whereClause += ` AND p."siteId" = $${paramIndex}::text`;
      params.push(siteId);
      paramIndex++;
    }

    if (batchId) {
      whereClause += ` AND p."batch_id" = $${paramIndex}::text`;
      params.push(batchId);
      paramIndex++;
    }

    if (startDate) {
      whereClause += ` AND p."createdAt" >= $${paramIndex}::timestamp`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereClause += ` AND p."createdAt" <= $${paramIndex}::timestamp`;
      params.push(endDate);
      paramIndex++;
    }

    if (search) {
      whereClause += ` AND (u.name ILIKE $${paramIndex} OR s.name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Get total count
    const countResult = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*) as count FROM "Payment" p 
       INNER JOIN "User" u ON p."workerId" = u.id 
       INNER JOIN "Site" s ON p."siteId" = s.id
       ${whereClause}`,
      ...params,
    );

    const total = Number(countResult[0]?.count || 0);
    const totalPages = Math.ceil(total / Number(limit));
    const offset = (Number(page) - 1) * Number(limit);

    type PaymentStatus =
      | "PENDING"
      | "APPROVED"
      | "PAID"
      | "REVIEW"
      | "REJECTED";

    const payments = await prisma.$queryRawUnsafe(
      `SELECT 
    p.*,
    u.name as "workerName",
    U."imageUrl" as "workerImage",
    s.name as "siteName"
  FROM "Payment" p
  INNER JOIN "User" u ON p."workerId" = u.id
  INNER JOIN "Site" s ON p."siteId" = s.id
  ${whereClause}
  ORDER BY "${String(validSortField)}" ${String(validSortOrder)}
  LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      ...params,
      Number(limit),
      offset,
    );
    return res.status(200).json({
      success: true,
      payments,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching payments:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payments",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Approve multiple payments
export const approvePaymentsBatch = async (req: Request, res: Response) => {
  const { paymentIds } = req.body;
  const { userId } = req.body;

  if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Payment IDs are required",
    });
  }

  try {
    const result: any[] = await prisma.$queryRaw`
      UPDATE "Payment"
      SET 
        status = 'APPROVED'::"PaymentStatus",
        "approvedAt" = NOW()
      WHERE 
        id = ANY(${paymentIds}::text[])
        AND status != 'PAID'::"PaymentStatus"
      RETURNING id
    `;
    const paymentIdsToUpdate = result.map((r) => r.id);
    if (result.length === 0) {
      return res.status(200).json({
        success: false,
        message:
          "No payments were approved. They may have already been approved or paid.",
      });
    }
    if (result.length > 0) {
      const updatedWorkEntries = await prisma.$queryRaw<Array<{ id: string }>>`
          UPDATE "WorkEntry"
          SET status = 'APPROVED'::"WorkEntryStatus"
          WHERE "paymentId" = ANY(${paymentIdsToUpdate}::text[])
          RETURNING id
        `;
      if (updatedWorkEntries.length === 0) {
        return res.status(200).json({
          success: false,
          message:
            "Payments approved, but no associated work entries were found to update",
        });
      }
    }

    const approvedPayments = String(paymentIds);

    if (userId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (gen_random_uuid(), ${userId}::uuid, 'APPROVE_PAYMENTS', 'Payment', ${approvedPayments}, NOW())
      `;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully approved ${(result as any[]).length} payments`,
      approvedCount: (result as any[]).length,
    });
  } catch (error) {
    console.error("Error approving payments:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to approve payments",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Mark multiple payments as paid
export const markMultipleAsPaid = async (req: Request, res: Response) => {
  const { paymentIds } = req.body;
  const { userId } = req.body;

  if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Payment IDs are required",
    });
  }

  try {
    const result: any[] = await prisma.$queryRaw`
      UPDATE "Payment"
      SET 
        status = 'PAID'::"PaymentStatus",
        "paidAt" = NOW()
      WHERE 
        id = ANY(${paymentIds}::text[])
        AND status NOT IN ('PAID'::"PaymentStatus", 'REJECTED'::"PaymentStatus")      
      RETURNING id
    `;

    if (result.length === 0) {
      return res.status(200).json({
        success: false,
        message:
          "No payments were marked as paid. They may have already been paid or rejected.",
      });
    }
    const paymentIdsToUpdate = result.map((r) => r.id);
    if (result.length > 0) {
      const updatedWorkEntries: { id: string }[] = await prisma.$queryRaw`
          UPDATE "WorkEntry"
          SET status = 'PAID'::"WorkEntryStatus"
          WHERE "paymentId" = ANY(${paymentIdsToUpdate}::text[])
          RETURNING id
        `;

      if (updatedWorkEntries.length === 0) {
        await prisma.payment.updateMany({
          where: {
            id: { in: paymentIdsToUpdate },
          },
          data: {
            status: "APPROVED",
            paidAt: null,
          },
        });
        return res.status(200).json({
          success: false,
          message:
            "Payments marked as paid, but no associated work entries were found to update",
        });
      }
    }

    const PaidPayments = String(paymentIds);

    // Log activity
    if (userId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (gen_random_uuid(), ${userId}::uuid, 'PAY_PAYMENTS', 'Payment', ${PaidPayments}, NOW())
      `;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully marked ${(result as any[]).length} payments as paid`,
    });
  } catch (error) {
    console.error("Error marking payments as paid:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark payments as paid",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Approve single payment
export const approveSinglePayment = async (req: Request, res: Response) => {
  const { paymentId } = req.params;
  const { userId } = req.body;

  try {
    const updatedWorkEntries = await prisma.$queryRaw`
        UPDATE "WorkEntry"
        SET 
          status = 'APPROVED'::"WorkEntryStatus"
        WHERE 
          "paymentId" = ${paymentId}::text 
        RETURNING id
      `;
    if ((updatedWorkEntries as any[]).length === 0) {
      console.warn(
        `No work entries found for payment ${paymentId} when marking as paid`,
      );
      return res.status(200).json({
        success: false,
        message: "No associated work entries were found to update",
      });
    }

    const result = await prisma.$queryRaw`
      UPDATE "Payment"
      SET 
        status = 'APPROVED'::"PaymentStatus",
        "approvedAt" = NOW()
      WHERE 
        id = ${paymentId}::text
      RETURNING id
    `;

    if ((result as any[]).length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment not found or already approved",
      });
    }

    // Log activity
    if (userId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (gen_random_uuid(), ${userId}::uuid, 'APPROVE_PAYMENT', 'Payment', ${paymentId}, NOW())
      `;
    }

    return res.status(200).json({
      success: true,
      message: "Payment approved successfully",
    });
  } catch (error) {
    console.error("Error approving payment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to approve payment",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Mark single payment as paid
export const markSingleAsPaid = async (req: Request, res: Response) => {
  const { paymentId } = req.params;
  const { userId } = req.body;

  try {
    const updatedWorkEntries = await prisma.$queryRaw`
        UPDATE "WorkEntry"
        SET 
          status = 'PAID'::"WorkEntryStatus"
        WHERE 
          "paymentId" = ${paymentId}::text 
        RETURNING id
      `;
    if ((updatedWorkEntries as any[]).length === 0) {
      console.warn(
        `No work entries found for payment ${paymentId} when marking as paid`,
      );
      return res.status(200).json({
        success: false,
        message: "No associated work entries were found to update",
      });
    }

    const result = await prisma.$queryRaw`
      UPDATE "Payment"
      SET 
        status = 'PAID'::"PaymentStatus",
        "paidAt" = NOW()
      WHERE 
        id = ${paymentId}::text
        AND status IN ('PENDING'::"PaymentStatus", 'APPROVED'::"PaymentStatus", 'REVIEW'::"PaymentStatus")
      RETURNING id
    `;

    if ((result as any[]).length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment not found or already paid, or Rejected",
      });
    }

    // Log activity
    if (userId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (gen_random_uuid(), ${userId}::uuid, 'PAY_PAYMENT', 'Payment', ${paymentId}, NOW())
      `;
    }

    return res.status(200).json({
      success: true,
      message: "Payment marked as paid successfully",
    });
  } catch (error) {
    console.error("Error marking payment as paid:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark payment as paid",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Send single payment for review by the foreman to the owner
export const reviewSinglePayment = async (req: Request, res: Response) => {
  const { paymentId } = req.params;
  const { reviewNotes } = req.body;
  const userId = req.user.id;

  try {
    const updatedWorkEntries = await prisma.$queryRaw`
        UPDATE "WorkEntry"
        SET 
          status = 'REVIEW'::"WorkEntryStatus"
        WHERE 
          "paymentId" = ${paymentId}::text 
        RETURNING id
      `;
    if ((updatedWorkEntries as any[]).length === 0) {
      console.warn(
        `No work entries found for payment ${paymentId} when sending for review`,
      );
      return res.status(200).json({
        success: false,
        message: "No associated work entries were found to update",
      });
    }

    const result = await prisma.$queryRaw`
      UPDATE "Payment"
      SET 
        status = 'REVIEW'::"PaymentStatus",
        "approvedAt" = NULL
      WHERE 
        id = ${paymentId}::uuid
        AND status in ('APPROVED'::"PaymentStatus", 'REJECTED'::"PaymentStatus")
      RETURNING id
    `;

    if ((result as any[]).length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment not found or not in pending status",
      });
    }

    // Log activity
    if (userId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (gen_random_uuid(), ${userId}::uuid, 'REVIEW_PAYMENT', 'Payment', ${paymentId}, NOW())
      `;
    }

    return res.status(200).json({
      success: true,
      message: "Payment sent for review successfully",
    });
  } catch (error) {
    console.error("Error sending payment for review:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send payment for review",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

//sending a batch for review by the foreman to the owner/admin
export const reviewMultiplePayments = async (req: Request, res: Response) => {
  const { paymentIds } = req.body;
  const { userId } = req.body;

  if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Payment IDs are required",
    });
  }

  try {
    const result: any[] = await prisma.$queryRaw`
      UPDATE "Payment"
      SET 
        status = 'APPROVED'::"PaymentStatus",
        "approvedAt" = NOW()
      WHERE 
        id = ANY(${paymentIds}::text[])
        AND status not in ('PAID'::"PaymentStatus", 'REVIEW'::"PaymentStatus")
      RETURNING id
    `;
    const paymentIdsToUpdate = result.map((r) => r.id);
    if (result.length === 0) {
      return res.status(200).json({
        success: false,
        message:
          "No payments were sent for review. They may have already been approved or paid.",
      });
    }
    if (result.length > 0) {
      const updatedWorkEntries = await prisma.$queryRaw<Array<{ id: string }>>`
          UPDATE "WorkEntry"
          SET status = 'REVIEW'::"WorkEntryStatus"
          WHERE "paymentId" = ANY(${paymentIdsToUpdate}::text[])
          RETURNING id
        `;
      if (updatedWorkEntries.length === 0) {
        return res.status(200).json({
          success: false,
          message:
            "Payments Where sent for review, but no associated work entries were found to update",
        });
      }
    }

    const PaymentsForReview = String(paymentIds);

    if (userId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (gen_random_uuid(), ${userId}::uuid, 'APPROVE_PAYMENTS', 'Payment', ${PaymentsForReview}, NOW())
      `;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully approved ${(result as any[]).length} payments`,
      approvedCount: (result as any[]).length,
    });
  } catch (error) {
    console.error("Error approving payments:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to approve payments",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Rejecting the selected payments
export const rejectingMultiplePayments = async (
  req: Request,
  res: Response,
) => {
  const { paymentIds } = req.body;
  const { userId } = req.body;

  if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Payment IDs are required",
    });
  }

  try {
    const result: any[] = await prisma.$queryRaw`
      UPDATE "Payment"
      SET 
        status = 'REJECTED'::"PaymentStatus",
        "paidAt" = NOW()
      WHERE 
        id = ANY(${paymentIds}::text[])
        AND status NOT IN ('PAID'::"PaymentStatus", 'APPROVED'::"PaymentStatus", 'REJECTED'::"PaymentStatus")
      RETURNING id
    `;

    if (result.length === 0) {
      return res.status(200).json({
        success: false,
        message:
          "No payments were Rejected. They may have already been approved or paid.",
      });
    }
    const paymentIdsToUpdate = result.map((r) => r.id);
    if (result.length > 0) {
      const updatedWorkEntries: { id: string }[] = await prisma.$queryRaw`
          UPDATE "WorkEntry"
          SET status = 'PAID'::"WorkEntryStatus"
          WHERE "paymentId" = ANY(${paymentIdsToUpdate}::text[])
          RETURNING id
        `;

      if (updatedWorkEntries.length === 0) {
        return res.status(200).json({
          success: false,
          message:
            "Payments marked as REJECTED, but no associated work entries were found to update",
        });
      }
    }

    const Rejected = String(paymentIds);

    // Log activity
    if (userId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (gen_random_uuid(), ${userId}::uuid, 'PAY_PAYMENTS', 'Payment', ${Rejected}, NOW())
      `;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully marked ${(result as any[]).length} payments as paid`,
    });
  } catch (error) {
    console.error("Error marking payments as paid:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark payments as paid",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Reject single payment (sending it back to foreman for review)
export const rejectSinglePayment = async (req: Request, res: Response) => {
  const { paymentId } = req.params;
  const { reason } = req.body;
  const userId = req.user.id;
  try {
    const updatedWorkEntries = await prisma.$queryRaw`
        UPDATE "WorkEntry"
        SET 
          status = 'REJECTED'::"WorkEntryStatus"
        WHERE 
          "paymentId" = ${paymentId}::text 
        RETURNING id
      `;
    if ((updatedWorkEntries as any[]).length === 0) {
      await prisma.$queryRaw` 
      delete from "Payment" where id = ${paymentId}::text`;

      console.warn(
        `No work entries found for payment ${paymentId} when rejecting payment`,
      );
      return res.status(200).json({
        success: false,
        message: "No associated work entries were found to update",
      });
    }

    const result = await prisma.$queryRaw`
      UPDATE "Payment"
      SET 
        status = 'REJECTED'::"PaymentStatus",
        "approvedAt" = NULL
      WHERE 
        id = ${paymentId}::text
        AND status = ANY(ARRAY['PENDING','APPROVED','REVIEW']::"PaymentStatus"[]) 
      RETURNING id
    `;

    if ((result as any[]).length === 0) {
      await prisma.$queryRaw`
        UPDATE "WorkEntry"
        SET 
          status = 'PENDING'::"WorkEntryStatus"
        WHERE 
          "paymentId" = ${paymentId}::text 
        RETURNING id
      `;

      await prisma.$queryRaw`
        UPDATE "Payment"
        SET
          status = 'PENDING'::"PaymentStatus",
          "approvedAt" = NULL
        WHERE 
          id = ${paymentId}::text
      `;

      return res.status(404).json({
        success: false,
        message: "Payment not found or payment status is already updated",
      });
    }

    // Log activity
    if (userId) {
      await prisma.$executeRaw`
        INSERT INTO "ActivityLog" (id, "userId", action, entity, "entityId", "createdAt")
        VALUES (gen_random_uuid(), ${userId}::uuid, 'REJECT_PAYMENT', 'Payment', ${paymentId}, NOW())
      `;
    }

    return res.status(200).json({
      success: true,
      message: "Payment rejected successfully",
    });
  } catch (error) {
    console.error("Error rejecting payment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reject payment",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Get all batches (with optional site filter)
export const getAllBatches = async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 20,
    sortField = "createdAt",
    sortOrder = "desc",
    status,
    siteId,
    batchId,
    startDate,
    endDate,
    search,
  } = req.query;

  try {
    const allowedSortFields = [
      "createdAt",
      "totalAmount",
      "totalPayments",
      "siteName",
      "status",
    ] as const;
    const validSortField = allowedSortFields.includes(sortField as any)
      ? (sortField as (typeof allowedSortFields)[number])
      : "createdAt";

    const validSortOrder =
      sortOrder === "asc" || sortOrder === "desc" ? sortOrder : "desc";

    // Build WHERE clause for individual payments
    let whereClause = 'WHERE p."batch_id" IS NOT NULL';
    const params: any[] = [];
    let paramIndex = 1;

    if (siteId) {
      whereClause += ` AND p."siteId" = $${paramIndex}::uuid`;
      params.push(siteId);
      paramIndex++;
    }

    if (batchId) {
      whereClause += ` AND p."batch_id" = $${paramIndex}::uuid`;
      params.push(batchId);
      paramIndex++;
    }

    if (startDate) {
      whereClause += ` AND p."createdAt" >= $${paramIndex}::timestamp`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereClause += ` AND p."createdAt" <= $${paramIndex}::timestamp`;
      params.push(endDate);
      paramIndex++;
    }

    if (search) {
      whereClause += ` AND s.name ILIKE $${paramIndex}`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Base batch aggregation query
    let batchQuery = `
      SELECT 
        p."batch_id" as "batchId",
        MIN(p."createdAt") as "createdAt",
        s.name as "siteName",
        COUNT(*)::int as "totalPayments",
        SUM(p."totalAmount")::float as "totalAmount",
        CASE 
          WHEN COUNT(*) FILTER (WHERE p.status = 'PAID') = COUNT(*) THEN 'PAID'
          WHEN COUNT(*) FILTER (WHERE p.status = 'APPROVED') > 0 
           AND COUNT(*) FILTER (WHERE p.status = 'PENDING') = 0 THEN 'PARTIALLY_APPROVED'
          WHEN COUNT(*) FILTER (WHERE p.status = 'PENDING') = COUNT(*) THEN 'PENDING'
          WHEN COUNT(*) FILTER (WHERE p.status = 'APPROVED') > 0 
           AND COUNT(*) FILTER (WHERE p.status = 'PENDING') > 0 THEN 'MIXED'
          ELSE 'MIXED'
        END as status,
        JSONB_BUILD_OBJECT(
          'pending', COUNT(*) FILTER (WHERE p.status = 'PENDING'),
          'approved', COUNT(*) FILTER (WHERE p.status = 'APPROVED'),
          'paid', COUNT(*) FILTER (WHERE p.status = 'PAID')
        ) as breakdown
      FROM "Payment" p
      INNER JOIN "Site" s ON p."siteId" = s.id
      ${whereClause}
      GROUP BY p."batch_id", s.name
    `;

    // Apply status filter on the derived batch status
    if (status && status !== "all") {
      batchQuery = `
        WITH batch_groups AS (${batchQuery})
        SELECT * FROM batch_groups
        WHERE status = $${paramIndex}
      `;
      params.push(status);
      paramIndex++;
    }

    // Get total count - convert BigInt to number
    const countResult = await prisma.$queryRawUnsafe<
      Array<{ count: bigint | number }>
    >(
      `SELECT COUNT(*)::int as count FROM (${batchQuery}) as batches`,
      ...params,
    );

    const total = Number(countResult[0]?.count || 0);
    const totalPages = Math.ceil(total / Number(limit));
    const offset = (Number(page) - 1) * Number(limit);

    // Get batches with pagination
    const batchesRaw = await prisma.$queryRawUnsafe<any[]>(
      `${batchQuery}
      ORDER BY "${String(validSortField)}" ${String(validSortOrder)}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      ...params,
      Number(limit),
      offset,
    );

    // Convert BigInt values to numbers in the results
    const batches = batchesRaw.map((batch) => ({
      ...batch,
      totalPayments: Number(batch.totalPayments),
      totalAmount:
        typeof batch.totalAmount === "bigint"
          ? Number(batch.totalAmount)
          : batch.totalAmount,
      breakdown: batch.breakdown
        ? {
            pending: Number(batch.breakdown.pending),
            approved: Number(batch.breakdown.approved),
            paid: Number(batch.breakdown.paid),
          }
        : batch.breakdown,
    }));

    return res.status(200).json({
      success: true,
      batches,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages,
      },
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

// Get payment sites for filtering
export const getPaymentSites = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const userRole = req.user?.role;

  try {
    let sites;

    if (userRole === "OWNER") {
      // Owner sees all their sites
      sites = await prisma.$queryRaw`
        SELECT DISTINCT s.id, s.name
        FROM "Site" s
        WHERE s."ownerId" = ${userId}::uuid
        ORDER BY s.name
      `;
    } else if (userRole === "FOREMAN") {
      // Foreman sees sites they manage
      sites = await prisma.$queryRaw`
        SELECT DISTINCT s.id, s.name
        FROM "Site" s
        WHERE s."foremanId" = ${userId}::uuid
        ORDER BY s.name
      `;
    } else {
      sites = [];
    }

    return res.status(200).json({
      success: true,
      sites,
    });
  } catch (error) {
    console.error("Error fetching sites:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch sites",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Get payment statistics
// export const getPaymentStatistics = async (req: Request, res: Response) => {
//   const userId = req.user?.id;
//   const userRole = req.user?.role;

//   try {
//     let siteFilter = "";
//     const params: any[] = [];
//     let paramIndex = 1;

//     if (userRole === "OWNER") {
//       siteFilter = `WHERE s."ownerId" = $${paramIndex}::uuid`;
//       params.push(userId);
//       paramIndex++;
//     } else if (userRole === "FOREMAN") {
//       siteFilter = `WHERE s."foremanId" = $${paramIndex}::uuid`;
//       params.push(userId);
//       paramIndex++;
//     }

//     const statistics = await prisma.$queryRawUnsafe(
//       `SELECT
//         COUNT(*) FILTER (WHERE p.status = 'PENDING') as "pendingCount",
//         COUNT(*) FILTER (WHERE p.status = 'APPROVED') as "approvedCount",
//         COUNT(*) FILTER (WHERE p.status = 'PAID') as "paidCount",
//         COUNT(*) FILTER (WHERE p.status = 'REVIEW') as "reviewCount",
//         COUNT(*) FILTER (WHERE p.status = 'REJECTED') as "rejectedCount",
//         COALESCE(SUM(p."totalAmount") FILTER (WHERE p.status = 'PENDING'), 0) as "pendingAmount",
//         COALESCE(SUM(p."totalAmount") FILTER (WHERE p.status = 'APPROVED'), 0) as "approvedAmount",
//         COALESCE(SUM(p."totalAmount") FILTER (WHERE p.status = 'PAID'), 0) as "paidAmount",
//         COUNT(DISTINCT p."batchId") as "totalBatches"
//       FROM "Payment" p
//       INNER JOIN "Site" s ON p."siteId" = s.id
//       ${siteFilter}`,
//       ...params,
//     );

//     return res.status(200).json({
//       success: true,
//       statistics: statistics[0],
//     });
//   } catch (error) {
//     console.error("Error fetching payment statistics:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch statistics",
//       error: error instanceof Error ? error.message : String(error),
//     });
//   }
// };

// Export payments to CSV
// export const exportPayments = async (req: Request, res: Response) => {
//   const { status, siteId, startDate, endDate } = req.query;

//   try {
//     let whereClause = "WHERE 1=1";
//     const params: any[] = [];
//     let paramIndex = 1;

//     if (status && status !== "all") {
//       whereClause += ` AND p.status = $${paramIndex}::"PaymentStatus"`;
//       params.push(status);
//       paramIndex++;
//     }

//     if (siteId) {
//       whereClause += ` AND p."siteId" = $${paramIndex}::uuid`;
//       params.push(siteId);
//       paramIndex++;
//     }

//     if (startDate) {
//       whereClause += ` AND p."createdAt" >= $${paramIndex}::timestamp`;
//       params.push(startDate);
//       paramIndex++;
//     }

//     if (endDate) {
//       whereClause += ` AND p."createdAt" <= $${paramIndex}::timestamp`;
//       params.push(endDate);
//       paramIndex++;
//     }

//     const payments = await prisma.$queryRawUnsafe(
//       `SELECT
//         p.id,
//         u.name as "Worker Name",
//         s.name as "Site Name",
//         p.month,
//         p.year,
//         p."totalHours" as "Total Hours",
//         p."totalAmount" as "Total Amount",
//         p.status as "Status",
//         p."createdAt" as "Created At",
//         p."approvedAt" as "Approved At",
//         p."paidAt" as "Paid At",
//         p."batchId" as "Batch ID"
//       FROM "Payment" p
//       INNER JOIN "User" u ON p."workerId" = u.id
//       INNER JOIN "Site" s ON p."siteId" = s.id
//       ${whereClause}
//       ORDER BY p."createdAt" DESC`,
//       ...params,
//     );

//     // Convert to CSV
//     const csvRows = [];
//     const headers = Object.keys(payments[0] || {});
//     csvRows.push(headers.join(","));

//     for (const payment of payments as any[]) {
//       const values = headers.map((header) => {
//         const value = payment[header];
//         if (value === null || value === undefined) return "";
//         if (typeof value === "string" && value.includes(","))
//           return `"${value}"`;
//         if (value instanceof Date) return value.toISOString();
//         return value;
//       });
//       csvRows.push(values.join(","));
//     }

//     const csvContent = csvRows.join("\n");

//     res.setHeader("Content-Type", "text/csv");
//     res.setHeader(
//       "Content-Disposition",
//       `attachment; filename=payments_export_${Date.now()}.csv`,
//     );
//     return res.status(200).send(csvContent);
//   } catch (error) {
//     console.error("Error exporting payments:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to export payments",
//       error: error instanceof Error ? error.message : String(error),
//     });
//   }
// };

// Get payment summary by date range
export const getPaymentSummary = async (req: Request, res: Response) => {
  const { startDate, endDate, siteId } = req.query;
  const userId = req.user?.id;
  const userRole = req.user?.role;

  try {
    let whereClause = "WHERE 1=1";
    const params: any[] = [];
    let paramIndex = 1;

    if (startDate) {
      whereClause += ` AND p."createdAt" >= $${paramIndex}::timestamp`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereClause += ` AND p."createdAt" <= $${paramIndex}::timestamp`;
      params.push(endDate);
      paramIndex++;
    }

    if (siteId) {
      whereClause += ` AND p."siteId" = $${paramIndex}::uuid`;
      params.push(siteId);
      paramIndex++;
    }

    if (userRole === "OWNER") {
      whereClause += ` AND s."ownerId" = $${paramIndex}::uuid`;
      params.push(userId);
      paramIndex++;
    } else if (userRole === "FOREMAN") {
      whereClause += ` AND s."foremanId" = $${paramIndex}::uuid`;
      params.push(userId);
      paramIndex++;
    }

    const summary = await prisma.$queryRawUnsafe(
      `SELECT 
        DATE(p."createdAt") as date,
        COUNT(*) as "totalPayments",
        SUM(p."totalAmount") as "totalAmount",
        COUNT(*) FILTER (WHERE p.status = 'PENDING') as "pendingCount",
        COUNT(*) FILTER (WHERE p.status = 'APPROVED') as "approvedCount",
        COUNT(*) FILTER (WHERE p.status = 'PAID') as "paidCount"
      FROM "Payment" p
      INNER JOIN "Site" s ON p."siteId" = s.id
      ${whereClause}
      GROUP BY DATE(p."createdAt")
      ORDER BY DATE(p."createdAt") DESC`,
      ...params,
    );

    return res.status(200).json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error("Error fetching payment summary:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment summary",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Updating a workentry statuses after before payment is done ' for purpose of reviewing and making things right before payment is done
export const updateWorkEntriesStatus = async (req: Request, res: Response) => {
  const { status } = req.params;
  const { entryIds, workerId } = req.body;

  if (!entryIds || !Array.isArray(entryIds) || entryIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: "entryIds must be a non-empty array",
      data: null,
    });
  }

  const statusMap = ["PENDING", "REJECTED", "REVIEW", "APPROVED", "NOT_PAID"];

  const newStatus = statusMap.find((s) => s === status);

  if (!newStatus) {
    return res.status(400).json({
      success: false,
      message: "Invalid status",
      data: null,
    });
  }

  const verifiedWorker = await validateUser(workerId);

  if (!verifiedWorker.success) {
    return res.status(200).json({
      success: false,
      message: verifiedWorker.message || "Worker validation failed",
      data: null,
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updatedWorkEntriesRaw: {
        id: string;
        paymentId: string | null;
      }[] = await tx.$queryRaw`
        UPDATE "WorkEntry"
        SET status = ${newStatus}::"WorkEntryStatus"
        WHERE id = ANY(${entryIds}::text[]) and status != 'PAID'::"WorkEntryStatus"
        RETURNING id, "paymentId"
      `;

      if (updatedWorkEntriesRaw.length === 0) {
        throw new Error("No work entries found");
      }

      const updatedEntryCount = updatedWorkEntriesRaw.length;

      const affectedPaymentIds = [
        ...new Set(
          updatedWorkEntriesRaw
            .map((row) => row.paymentId)
            .filter((id): id is string => id !== null),
        ),
      ];

      const updatedPayments = [];

      if (status === "PAID" || status === "NOT_PAID") {
        for (const paymentId of affectedPaymentIds) {
          // Getting status distribution + totals in ONE query
          const paymentStats: {
            totalentries: string;
            pendingcount: string;
            reviewcount: string;
            approvedcount: string;
            rejectedcount: string;
            paidcount: string;
            notpaidcount: string;
            amount: number;
          }[] = await tx.$queryRaw`
    SELECT
      COUNT(*) as "totalentries",

      COUNT(*) FILTER (
        WHERE status = 'PENDING'::"WorkEntryStatus"
      ) as "pendingcount",

      COUNT(*) FILTER (
        WHERE status = 'REVIEW'::"WorkEntryStatus"
      ) as "reviewcount",

      COUNT(*) FILTER (
        WHERE status = 'APPROVED'::"WorkEntryStatus"
      ) as "approvedcount",

      COUNT(*) FILTER (
        WHERE status = 'REJECTED'::"WorkEntryStatus"
      ) as "rejectedcount",

      COUNT(*) FILTER (
        WHERE status = 'PAID'::"WorkEntryStatus"
      ) as "paidcount",

      COUNT(*) FILTER (
        WHERE status = 'NOT_PAID'::"WorkEntryStatus"
      ) as "notpaidcount",

      COALESCE(SUM(amount), 0) as "amount"

    FROM "WorkEntry"
    WHERE "paymentId" = ${paymentId}::text
  `;

          const stats = paymentStats[0];

          const totalEntries = Number(stats.totalentries);

          const pendingCount = Number(stats.pendingcount);
          const reviewCount = Number(stats.reviewcount);
          const approvedCount = Number(stats.approvedcount);
          const rejectedCount = Number(stats.rejectedcount);
          const paidCount = Number(stats.paidcount);
          const notPaidCount = Number(stats.notpaidcount);

          const totalAmount = Number(stats.amount);

          // CASE 1:
          // if  ALL entries became NOT_PAID  DELETE payment
          if (notPaidCount === totalEntries) {
            await tx.payment.delete({
              where: {
                id: paymentId,
              },
            });

            continue;
          }

          // Determing payment status ONLY if ALL entries match
          let paymentStatus: PaymentStatus | null = null;

          if (pendingCount === totalEntries) {
            paymentStatus = "PENDING";
          } else if (reviewCount === totalEntries) {
            paymentStatus = "REVIEW";
          } else if (approvedCount === totalEntries) {
            paymentStatus = "APPROVED";
          } else if (rejectedCount === totalEntries) {
            paymentStatus = "REJECTED";
          } else if (paidCount === totalEntries) {
            paymentStatus = "PAID";
          }

          // Updating payment
          await tx.payment.update({
            where: {
              id: paymentId,
            },
            data: {
              totalAmount,

              ...(paymentStatus && {
                status: paymentStatus,
              }),

              ...(paymentStatus === "PAID" && {
                paidAt: new Date(),
              }),

              ...(paymentStatus === "APPROVED" && {
                approvedAt: new Date(),
              }),
            },
          });

          updatedPayments.push({
            paymentId,
            paymentStatus,
          });
        }
      } else {
        affectedPaymentIds.map((paymentId) => updatedPayments.push(paymentId));
        for (const paymentId of affectedPaymentIds) {
          // Getting status distribution + totals in ONE query

          const paymentStats: {
            totalentries: string;
            pendingcount: string;
            reviewcount: string;
            approvedcount: string;
            rejectedcount: string;
            paidcount: string;
            notpaidcount: string;
            amount: string;
          }[] = await tx.$queryRaw`
            SELECT
              COUNT(*) as "totalentries",

              COUNT(*) FILTER (
                WHERE status = 'PENDING'::"WorkEntryStatus"
              ) as "pendingcount",

              COUNT(*) FILTER (
                WHERE status = 'REVIEW'::"WorkEntryStatus"
              ) as "reviewcount",

              COUNT(*) FILTER (
                WHERE status = 'APPROVED'::"WorkEntryStatus"
              ) as "approvedcount",

              COUNT(*) FILTER (
                WHERE status = 'REJECTED'::"WorkEntryStatus"
              ) as "rejectedcount",

              COUNT(*) FILTER (
                WHERE status = 'PAID'::"WorkEntryStatus"
              ) as "paidcount",

              COUNT(*) FILTER (
                WHERE status = 'NOT_PAID'::"WorkEntryStatus"
              ) as "notpaidcount",
              
              COALESCE(SUM(amount), 0) as "amount",

            FROM "WorkEntry"
            WHERE "paymentId" = ${paymentId}::text
          `;

          const stats = paymentStats[0];

          const totalEntries = Number(stats.totalentries);

          const pendingCount = Number(stats.pendingcount);
          const reviewCount = Number(stats.reviewcount);
          const approvedCount = Number(stats.approvedcount);
          const rejectedCount = Number(stats.rejectedcount);
          const paidCount = Number(stats.paidcount);
          const notPaidCount = Number(stats.notpaidcount);

          const totalAmount = Number(stats.amount);

          // CASE 1: ALL entries became NOT_PAID DELETE payment
          if (notPaidCount === totalEntries) {
            await tx.payment.delete({
              where: {
                id: paymentId,
              },
            });

            continue;
          }

          // Determining payment status ONLY if ALL entries match

          let paymentStatus: PaymentStatus | null = null;

          if (pendingCount === totalEntries) {
            paymentStatus = "PENDING";
          } else if (reviewCount === totalEntries) {
            paymentStatus = "REVIEW";
          } else if (approvedCount === totalEntries) {
            paymentStatus = "APPROVED";
          } else if (rejectedCount === totalEntries) {
            paymentStatus = "REJECTED";
          } else if (paidCount === totalEntries) {
            paymentStatus = "PAID";
          }

          // Updating payment
          await tx.payment.update({
            where: {
              id: paymentId,
            },
            data: {
              ...(paymentStatus && {
                status: paymentStatus,
              }),

              ...(paymentStatus === "PAID" && {
                paidAt: new Date(),
              }),

              ...(paymentStatus === "APPROVED" && {
                approvedAt: new Date(),
              }),
            },
          });

          updatedPayments.push({
            paymentId,
            paymentStatus,
          });
        }
      }

      return {
        updatedWorkEntrycount: updatedEntryCount,
        updatedPayments,
      };
    });

    return res.status(200).json({
      success: true,
      message: `Successfully updated ${result.updatedWorkEntrycount} work entry(ies) status to ${status}.`,
      data: result,
    });
  } catch (error) {
    console.error("Error updating work entries status:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to update work entries",
      data: null,
    });
  }
};
