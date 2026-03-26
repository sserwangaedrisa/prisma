import prisma from "../../prisma/config";
import type { Request, Response } from "express";
import { validateUser, validateMonthNotLocked } from "../middleware/validation";

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
// payment for the whole site for a specific date range

export const sitePayment = async (req: Request, res: Response) => {
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

    const monthValidation = await validateMonthNotLocked(siteId, start);
    if (!monthValidation.success) {
      return res.status(200).json({
        message: monthValidation.message,
        success: false,
      });
    }

    // Get all work entries with worker details
    const workEntries = await prisma.workEntry.findMany({
      where: {
        siteId: siteId,
        date: {
          gte: start,
          lte: end,
        },
      },
      select: {
        id: true,
        date: true,
        hours: true,
        overtime: true,
        worker: {
          select: {
            id: true,
            name: true,
            wageRating: true,
            role: true,
            job: true,
            isActive: true,
          },
        },
        site: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ worker: { name: "asc" } }, { date: "asc" }],
    });

    if (workEntries.length === 0) {
      return res.status(200).json({
        siteId,
        period: { startDate, endDate },
        workers: [],
        message: "No work entries found for this period",
      });
    }

    // Group by worker and calculate totals
    const workersMap = new Map();

    for (const entry of workEntries) {
      const workerId = entry.worker.id;
      const wageRating = entry.worker.wageRating || 0;
      const totalHoursForEntry = entry.hours + entry.overtime;
      const entryAmount = totalHoursForEntry * wageRating;

      if (!workersMap.has(workerId)) {
        workersMap.set(workerId, {
          worker: {
            id: entry.worker.id,
            name: entry.worker.name,
            wageRating: wageRating,
            role: entry.worker.role,
            job: entry.worker.job,
            isActive: entry.worker.isActive,
          },
          regularHours: 0,
          overtimeHours: 0,
          totalHours: 0,
          totalAmount: 0,
          entries: [],
          entryCount: 0,
        });
      }

      const workerData = workersMap.get(workerId);
      workerData.regularHours += entry.hours;
      workerData.overtimeHours += entry.overtime;
      workerData.totalHours += totalHoursForEntry;
      workerData.totalAmount += entryAmount;
      workerData.entryCount++;
      workerData.entries.push({
        id: entry.id,
        date: entry.date,
        hours: entry.hours,
        overtime: entry.overtime,
        totalHours: totalHoursForEntry,
        amount: Number(entryAmount.toFixed(2)),
      });
    }

    // Convert map to array and format
    const workers = Array.from(workersMap.values()).map((worker) => ({
      ...worker,
      regularHours: Number(worker.regularHours.toFixed(2)),
      overtimeHours: Number(worker.overtimeHours.toFixed(2)),
      totalHours: Number(worker.totalHours.toFixed(2)),
      totalAmount: Number(worker.totalAmount.toFixed(2)),
    }));

    // Sort by total amount (highest first)
    workers.sort((a, b) => b.totalAmount - a.totalAmount);

    const siteTotal = workers.reduce(
      (sum, worker) => sum + worker.totalAmount,
      0,
    );
    const totalSiteHours = workers.reduce(
      (sum, worker) => sum + worker.totalHours,
      0,
    );

    return res.status(200).json({
      success: true,
      site: {
        id: siteId,
        name: workEntries[0].site.name || siteId,
      },
      period: {
        startDate,
        endDate,
      },
      calculation: {
        formula: `Total Amount = (Regular Hours + Overtime) × Worker's Wage Rating`,
        description:
          "Each worker's total is calculated independently based on their individual wage rating",
      },
      summary: {
        totalWorkers: workers.length,
        totalEntries: workEntries.length,
        totalHours: Number(totalSiteHours.toFixed(2)),
        totalAmount: Number(siteTotal.toFixed(2)),
      },
      workers,
    });
  } catch (error) {
    console.error("Site payment calculation error:", error);
    return res
      .status(500)
      .json({ message: "Failed to calculate site payments", success: false });
  }
};
