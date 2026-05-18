import { Request, Response } from "express";
import prisma from "../../prisma/config";
import { validateUser, validateMonthNotLocked } from "../middleware/validation";

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------
const getDefaultDateRange = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return { startDate: startOfMonth, endDate: now };
};

const validateDateRange = (startStr?: string, endStr?: string) => {
  let startDate: Date, endDate: Date;

  if (!startStr || !endStr) {
    const defaults = getDefaultDateRange();
    startDate = defaults.startDate;
    endDate = defaults.endDate;
  } else {
    startDate = new Date(startStr);
    endDate = new Date(endStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error("Invalid date format. Use ISO date strings.");
    }

    if (
      startDate.getFullYear() !== endDate.getFullYear() ||
      startDate.getMonth() !== endDate.getMonth()
    ) {
      throw new Error("Date range must be within a single month.");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (endDate > today) {
      throw new Error("End date cannot be in the future.");
    }
  }

  return { startDate, endDate };
};

// ----------------------------------------------------------------------
// 1. Site Summaries (overview of payments & work entries per site)
// ----------------------------------------------------------------------
export const getSiteSummaries = async (req: Request, res: Response) => {
  try {
    const sites = await prisma.site.findMany({
      include: {
        payments: {
          select: {
            status: true,
            totalAmount: true,
          },
        },
        workEntries: {
          select: {
            status: true,
          },
        },
      },
    });

    const summaries = sites.map((site) => {
      // Payment status counts based on actual enum: PENDING, APPROVED, REVIEW, REJECTED, PAID
      const paymentStatuses = {
        PENDING: 0,
        APPROVED: 0,
        REVIEW: 0,
        REJECTED: 0,
        PAID: 0,
      };
      let totalAmount = 0;

      site.payments.forEach((payment) => {
        const status = payment.status as keyof typeof paymentStatuses;
        if (status in paymentStatuses) paymentStatuses[status]++;
        totalAmount += payment.totalAmount || 0;
      });

      // WorkEntry statuses: NOT_PAID, PENDING, PAID, APPROVED, REVIEW, REJECTED
      const workEntryStatuses = {
        NOT_PAID: 0,
        PENDING: 0,
        PAID: 0,
        APPROVED: 0,
        REVIEW: 0,
        REJECTED: 0,
      };

      site.workEntries.forEach((entry) => {
        const status = entry.status as keyof typeof workEntryStatuses;
        if (status in workEntryStatuses) workEntryStatuses[status]++;
      });

      return {
        siteId: site.id,
        siteName: site.name,
        location: site.location,
        paymentSummary: paymentStatuses,
        totalPaymentAmount: totalAmount,
        workEntrySummary: workEntryStatuses,
      };
    });

    res.status(200).json({ success: true, data: summaries });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching site summaries",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// ----------------------------------------------------------------------
// 2. Monthly Comparison (statistics over N months)
// ----------------------------------------------------------------------
export const getMonthlyComparison = async (req: Request, res: Response) => {
  try {
    const { siteId, months = 12 } = req.query;
    const currentDate = new Date();
    const startDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() - (Number(months) - 1),
      1,
    );

    // Payments use createdAt (as per schema)
    const paymentData = await prisma.payment.groupBy({
      by: ["createdAt", "status"],
      where: {
        ...(siteId && { siteId: String(siteId) }),
        createdAt: { gte: startDate, lte: currentDate },
      },
      _sum: { totalAmount: true },
      _count: true,
    });

    // WorkEntries use date field (not createdAt)
    const workEntryData = await prisma.workEntry.groupBy({
      by: ["date", "status"],
      where: {
        ...(siteId && { siteId: String(siteId) }),
        date: { gte: startDate, lte: currentDate },
      },
      _count: true,
    });

    const monthlyStats: Record<string, any> = {};

    paymentData.forEach((record) => {
      const monthKey = record.createdAt.toISOString().slice(0, 7);
      if (!monthlyStats[monthKey])
        monthlyStats[monthKey] = { payments: {}, workEntries: {} };
      monthlyStats[monthKey].payments[record.status] = {
        count: record._count,
        total: record._sum.totalAmount || 0,
      };
    });

    workEntryData.forEach((record) => {
      const monthKey = record.date.toISOString().slice(0, 7);
      if (!monthlyStats[monthKey])
        monthlyStats[monthKey] = { payments: {}, workEntries: {} };
      monthlyStats[monthKey].workEntries[record.status] = {
        count: record._count,
      };
    });

    res.status(200).json({ success: true, data: monthlyStats });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching monthly comparison",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// ----------------------------------------------------------------------
// 3. Payment Status Report (detailed)
// ----------------------------------------------------------------------
export const getPaymentStatusReport = async (req: Request, res: Response) => {
  try {
    const { siteId } = req.query;
    const payments = await prisma.payment.findMany({
      where: { ...(siteId && { siteId: String(siteId) }) },
      include: {
        site: { select: { name: true, location: true } },
        worker: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const groupedByStatus = payments.reduce(
      (acc, payment) => {
        const status = payment.status;
        if (!acc[status]) acc[status] = [];
        acc[status].push(payment);
        return acc;
      },
      {} as Record<string, typeof payments>,
    );

    const report = Object.entries(groupedByStatus).map(([status, items]) => ({
      status,
      count: items.length,
      totalAmount: items.reduce(
        (sum, item) => sum + (item.totalAmount || 0),
        0,
      ),
      payments: items,
    }));

    res.status(200).json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching payment status report",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// ----------------------------------------------------------------------
// 4. Work Entry Status Report (detailed)
// ----------------------------------------------------------------------
export const getWorkEntryStatusReport = async (req: Request, res: Response) => {
  try {
    const { siteId } = req.query;
    const workEntries = await prisma.workEntry.findMany({
      where: { ...(siteId && { siteId: String(siteId) }) },
      include: {
        site: { select: { name: true, location: true } },
        worker: { select: { name: true, email: true } },
      },
      orderBy: { date: "desc" },
    });

    const groupedByStatus = workEntries.reduce(
      (acc, entry) => {
        const status = entry.status;
        if (!acc[status]) acc[status] = [];
        acc[status].push(entry);
        return acc;
      },
      {} as Record<string, typeof workEntries>,
    );

    const report = Object.entries(groupedByStatus).map(([status, items]) => ({
      status,
      count: items.length,
      workEntries: items,
    }));

    res.status(200).json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching work entry status report",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// ----------------------------------------------------------------------
// 5. Company‑wide Report (date‑range, within single month)
// ----------------------------------------------------------------------
export const getCompanyReport = async (req: Request, res: Response) => {
  try {
    const { startDate: startStr, endDate: endStr } = req.query;
    const { startDate, endDate } = validateDateRange(
      startStr as string,
      endStr as string,
    );

    const workEntries = await prisma.workEntry.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      include: {
        site: { select: { id: true, name: true } },
        worker: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    const totalHours = workEntries.reduce((sum, e) => sum + e.hours, 0);
    const totalOvertime = workEntries.reduce((sum, e) => sum + e.overtime, 0);
    const uniqueWorkers = new Set(workEntries.map((e) => e.workerId)).size;
    const uniqueSites = new Set(workEntries.map((e) => e.siteId)).size;

    const siteBreakdown = workEntries.reduce(
      (acc, entry) => {
        const siteId = entry.siteId;
        if (!acc[siteId]) {
          acc[siteId] = {
            siteName: entry.site.name,
            totalHours: 0,
            totalOvertime: 0,
            workerCount: new Set<string>(),
          };
        }
        acc[siteId].totalHours += entry.hours;
        acc[siteId].totalOvertime += entry.overtime;
        acc[siteId].workerCount.add(entry.workerId);
        return acc;
      },
      {} as Record<
        string,
        {
          siteName: string;
          totalHours: number;
          totalOvertime: number;
          workerCount: Set<string>;
        }
      >,
    );

    const formattedSiteBreakdown = Object.entries(siteBreakdown).map(
      ([id, data]) => ({
        siteId: id,
        siteName: data.siteName,
        totalHours: data.totalHours,
        totalOvertime: data.totalOvertime,
        uniqueWorkers: data.workerCount.size,
      }),
    );

    const month = startDate.getMonth() + 1;
    const year = startDate.getFullYear();
    const payments = await prisma.payment.findMany({
      where: { month, year },
      select: { totalAmount: true, status: true },
    });

    const totalPaidAmount = payments
      .filter((p) => p.status === "PAID")
      .reduce((sum, p) => sum + p.totalAmount, 0);
    const totalPendingAmount = payments
      .filter((p) => p.status === "PENDING")
      .reduce((sum, p) => sum + p.totalAmount, 0);

    res.json({
      success: true,
      dateRange: { startDate, endDate },
      summary: {
        totalHours,
        totalOvertime,
        uniqueWorkers,
        uniqueSites,
        totalPaidAmount,
        totalPendingAmount,
      },
      siteBreakdown: formattedSiteBreakdown,
    });
  } catch (error: any) {
    console.error("Company report error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------------------------
// 6. Site‑specific Report (date‑range, within single month)
// ----------------------------------------------------------------------
export const getSiteReport = async (req: Request, res: Response) => {
  try {
    const { siteId } = req.params;
    const { startDate: startStr, endDate: endStr } = req.query;

    if (!siteId) {
      return res
        .status(400)
        .json({ success: false, message: "siteId is required" });
    }

    const { startDate, endDate } = validateDateRange(
      startStr as string,
      endStr as string,
    );

    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, name: true, location: true },
    });
    if (!site) {
      return res
        .status(404)
        .json({ success: false, message: "Site not found" });
    }

    const workEntries = await prisma.workEntry.findMany({
      where: {
        siteId,
        date: { gte: startDate, lte: endDate },
      },
      include: {
        worker: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    const totalHours = workEntries.reduce((sum, e) => sum + e.hours, 0);
    const totalOvertime = workEntries.reduce((sum, e) => sum + e.overtime, 0);
    const uniqueWorkers = new Set(workEntries.map((e) => e.workerId)).size;

    const workerBreakdown = workEntries.reduce(
      (acc, entry) => {
        const workerId = entry.workerId;
        if (!acc[workerId]) {
          acc[workerId] = {
            workerName: entry.worker.name,
            totalHours: 0,
            totalOvertime: 0,
            entriesCount: 0,
          };
        }
        acc[workerId].totalHours += entry.hours;
        acc[workerId].totalOvertime += entry.overtime;
        acc[workerId].entriesCount += 1;
        return acc;
      },
      {} as Record<
        string,
        {
          workerName: string;
          totalHours: number;
          totalOvertime: number;
          entriesCount: number;
        }
      >,
    );

    const formattedWorkerBreakdown = Object.entries(workerBreakdown).map(
      ([id, data]) => ({
        workerId: id,
        workerName: data.workerName,
        totalHours: data.totalHours,
        totalOvertime: data.totalOvertime,
        entriesCount: data.entriesCount,
      }),
    );

    const month = startDate.getMonth() + 1;
    const year = startDate.getFullYear();
    const payments = await prisma.payment.findMany({
      where: { siteId, month, year },
      select: { totalAmount: true, status: true },
    });

    const totalPaidAmount = payments
      .filter((p) => p.status === "PAID")
      .reduce((sum, p) => sum + p.totalAmount, 0);
    const totalPendingAmount = payments
      .filter((p) => p.status === "PENDING")
      .reduce((sum, p) => sum + p.totalAmount, 0);

    res.json({
      success: true,
      site: { id: site.id, name: site.name, location: site.location },
      dateRange: { startDate, endDate },
      summary: {
        totalHours,
        totalOvertime,
        uniqueWorkers,
        totalPaidAmount,
        totalPendingAmount,
      },
      workerBreakdown: formattedWorkerBreakdown,
    });
  } catch (error: any) {
    console.error("Site report error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------------------------
// 7. Workers Summary (hours, overtime, payment status per worker)
// ----------------------------------------------------------------------
export const getWorkersSummary = async (req: Request, res: Response) => {
  try {
    const { siteId, startDate: startStr, endDate: endStr } = req.query;
    const { startDate, endDate } = validateDateRange(
      startStr as string,
      endStr as string,
    );

    // Base where clause for work entries
    const workWhere: any = {
      date: { gte: startDate, lte: endDate },
    };
    if (siteId) workWhere.siteId = String(siteId);

    // Fetch all work entries in the period with worker and site info
    const workEntries = await prisma.workEntry.findMany({
      where: workWhere,
      include: {
        worker: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            phone: true,
            wageRating: true,
          },
        },
        site: {
          select: { id: true, name: true },
        },
      },
    });

    // Group by worker
    const workerMap = new Map<
      string,
      {
        workerId: string;
        workerName: string;
        workerEmail: string;
        workerRole: string;
        workerPhone: string | null;
        wageRating: number | null;
        totalHours: number;
        totalOvertime: number;
        sitesWorked: Set<string>;
        workEntriesCount: number;
        paymentSummary: {
          PAID: number;
          PENDING: number;
          APPROVED: number;
          REVIEW: number;
          REJECTED: number;
        };
      }
    >();

    for (const entry of workEntries) {
      const workerId = entry.workerId;
      if (!workerMap.has(workerId)) {
        workerMap.set(workerId, {
          workerId,
          workerName: entry.worker.name,
          workerEmail: entry.worker.email,
          workerRole: entry.worker.role,
          workerPhone: entry.worker.phone,
          wageRating: entry.worker.wageRating,
          totalHours: 0,
          totalOvertime: 0,
          sitesWorked: new Set(),
          workEntriesCount: 0,
          paymentSummary: {
            PAID: 0,
            PENDING: 0,
            APPROVED: 0,
            REVIEW: 0,
            REJECTED: 0,
          },
        });
      }

      const workerData = workerMap.get(workerId)!;
      workerData.totalHours += entry.hours;
      workerData.totalOvertime += entry.overtime;
      workerData.sitesWorked.add(entry.siteId);
      workerData.workEntriesCount += 1;
    }

    // Get payment data for these workers within the same month/year
    const month = startDate.getMonth() + 1;
    const year = startDate.getFullYear();

    const payments = await prisma.payment.findMany({
      where: {
        ...(siteId && { siteId: String(siteId) }),
        month,
        year,
        workerId: { in: Array.from(workerMap.keys()) },
      },
      select: {
        workerId: true,
        status: true,
        totalAmount: true,
      },
    });

    // Aggregate payment amounts per worker and status
    for (const payment of payments) {
      const workerData = workerMap.get(payment.workerId);
      if (workerData && payment.status in workerData.paymentSummary) {
        // For simplicity we just count payments, but you could also sum amounts
        workerData.paymentSummary[
          payment.status as keyof typeof workerData.paymentSummary
        ] += 1;
      }
    }

    // Convert map to array and format sitesWorked set to count
    const workersSummary = Array.from(workerMap.values()).map((w) => ({
      ...w,
      sitesWorkedCount: w.sitesWorked.size,
      sitesWorked: Array.from(w.sitesWorked), // optional: list of site IDs
    }));

    // Optional totals across all workers
    const overallTotals = {
      totalHours: workersSummary.reduce((sum, w) => sum + w.totalHours, 0),
      totalOvertime: workersSummary.reduce(
        (sum, w) => sum + w.totalOvertime,
        0,
      ),
      totalWorkers: workersSummary.length,
      totalWorkEntries: workersSummary.reduce(
        (sum, w) => sum + w.workEntriesCount,
        0,
      ),
    };

    res.json({
      success: true,
      dateRange: { startDate, endDate },
      filters: { siteId: siteId || null },
      overallTotals,
      workers: workersSummary,
    });
  } catch (error: any) {
    console.error("Workers summary error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};
