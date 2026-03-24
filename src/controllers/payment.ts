import prisma from "../../prisma/config";
import type { Request, Response } from "express";
import { validateUser, validateMonthNotLocked } from "../middleware/validation";
import { string } from "joi";

interface worker {
  id: string;
  status: string;
  isActive: boolean;
  name: string;
  job: string;
  email: string;
  role: string;
  wageRatings: number | null;
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

    // checking if worker is active
    // const worker = await prisma.user.findUnique({
    //   where: { id: workerId, isActive: true, status: "Active" },
    // });

    // if (!worker) {
    //   return res.status(200).json({
    //     message: "no user found",
    //     success: false,
    //   });
    // }
    // if (worker.status !== "Active") {
    //   return res.status(200).json({
    //     message: "user is blocked ",
    //     success: false,
    //   });
    // }
    // if (worker.isActive === false) {
    //   return res.status(200).json({
    //     message: "user is not activated",
    //     success: false,
    //   });
    // }

    const workerData = await validateUser(workerId);
    if (!workerData || !workerData.success) {
      return res.status(200).json({
        success: false,
        message: workerData.message,
      });
    }

    const worker: worker = workerData.data as worker;

    // Get worker's wage rating (rate per hour)
    const wageRating = worker?.wageRatings || 0;

    const start = new Date(startDate);
    const end = new Date(endDate);

    // checking for the closed month
    const monthClose = await prisma.monthClose.findUnique({
      where: {
        siteId_month_year: {
          siteId: siteId,
          month: start.getMonth() + 1,
          year: start.getFullYear(),
        },
      },
    });

    if (monthClose && monthClose.status === "LOCKED") {
      return res.status(403).json({
        success: false,
        message: " locked month",
        status: "locked month",
      });
    }

    // Single optimized query
    const workEntries = await prisma.workEntry.findMany({
      where: {
        workerId: workerId,
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
        notes: true,
        status: true,
        worker: {
          select: {
            id: true,
            name: true,
            email: true,
            wageRating: true,
            role: true,
            job: true,
          },
        },
        site: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        date: "asc",
      },
    });

    if (workEntries.length === 0) {
      return res.status(200).json({
        workerId,
        siteId,
        period: { startDate, endDate },
        hasEntries: false,
        message: "No work entries found for this period",
      });
    }

    // Calculate totals
    let totalRegularHours = 0;
    let totalOvertimeHours = 0;
    let totalHours = 0;

    const detailedEntries = workEntries.map((entry) => {
      const entryTotalHours = entry.hours + entry.overtime;
      const entryAmount = entryTotalHours * wageRating;

      totalRegularHours += entry.hours;
      totalOvertimeHours += entry.overtime;
      totalHours += entryTotalHours;

      return {
        id: entry.id,
        date: entry.date,
        hours: entry.hours,
        overtime: entry.overtime,
        totalHours: entryTotalHours,
        amount: Number(entryAmount.toFixed(2)),
        notes: entry.notes,
        status: entry.status,
      };
    });

    const totalAmount = totalHours * wageRating;

    const response = {
      worker: {
        id: worker?.id,
        name: worker?.name,
        email: worker?.email,
        wageRating: wageRating,
        role: worker?.role,
        job: worker?.job,
      },
      site: {
        id: workEntries[0].site.id,
        name: workEntries[0].site.name,
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
        entryCount: workEntries.length,
      },
    };
    return res.status(200).json({
      data: response,
      success: true,
      message: "entries retrived successfull",
    });
  } catch (error) {
    console.error("Payment calculation error:", error);
    return res
      .status(500)
      .json({ message: "Failed to calculate payment", status: 500 });
  }
};
