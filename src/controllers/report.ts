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

    // Remove single-month restriction - allow any date range
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (startDate > today) {
      throw new Error("Date cannot be in the future.");
    }
    if (startDate > endDate) {
      throw new Error("Start date must be before end date.");
    }
  }

  return { startDate, endDate };
};

// Pagination helper
const getPagination = (page: number = 1, limit: number = 10) => {
  const take = limit;
  const skip = (page - 1) * limit;
  return { take, skip };
};

// ----------------------------------------------------------------------
// 1. Site Summaries (overview of payments & work entries per site)
// ----------------------------------------------------------------------
export const getSiteSummaries = async (req: Request, res: Response) => {
  try {
    const {
      startDate: startStr,
      endDate: endStr,
      page = 1,
      limit = 10,
    } = req.body;

    const { startDate, endDate } = validateDateRange(
      startStr as string,
      endStr as string,
    );
    const { take, skip } = getPagination(Number(page), Number(limit));

    // Get total count for pagination
    const totalSites = await prisma.site.count();

    const sites = await prisma.site.findMany({
      skip,
      take,
      include: {
        payments: {
          where: {
            createdAt: { gte: startDate, lte: endDate },
          },
          select: {
            status: true,
            totalAmount: true,
          },
        },
        workEntries: {
          where: {
            date: { gte: startDate, lte: endDate },
          },
          select: {
            status: true,
          },
        },
      },
    });

    const summaries = sites.map((site) => {
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

    res.status(200).json({
      success: true,
      data: summaries,
      pagination: {
        currentPage: Number(page),
        itemsPerPage: Number(limit),
        totalItems: totalSites,
        totalPages: Math.ceil(totalSites / Number(limit)),
      },
    });
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

    const paymentData = await prisma.payment.groupBy({
      by: ["createdAt", "status"],
      where: {
        ...(siteId && { siteId: String(siteId) }),
        createdAt: { gte: startDate, lte: currentDate },
      },
      _sum: { totalAmount: true },
      _count: true,
    });

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
    const {
      siteId,
      startDate: startStr,
      endDate: endStr,
      page = 1,
      limit = 10,
    } = req.query;

    const { startDate, endDate } = validateDateRange(
      startStr as string,
      endStr as string,
    );
    const { take, skip } = getPagination(Number(page), Number(limit));

    const whereCondition: any = {
      ...(siteId && { siteId: String(siteId) }),
      createdAt: { gte: startDate, lte: endDate },
    };

    // Get total count for pagination
    const totalPayments = await prisma.payment.count({ where: whereCondition });

    const payments = await prisma.payment.findMany({
      where: whereCondition,
      include: {
        site: { select: { name: true, location: true } },
        worker: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
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

    res.status(200).json({
      success: true,
      data: report,
      pagination: {
        currentPage: Number(page),
        itemsPerPage: Number(limit),
        totalItems: totalPayments,
        totalPages: Math.ceil(totalPayments / Number(limit)),
      },
    });
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
    const {
      siteId,
      startDate: startStr,
      endDate: endStr,
      page = 1,
      limit = 10,
    } = req.query;

    const { startDate, endDate } = validateDateRange(
      startStr as string,
      endStr as string,
    );
    const { take, skip } = getPagination(Number(page), Number(limit));

    const whereCondition: any = {
      ...(siteId && { siteId: String(siteId) }),
      date: { gte: startDate, lte: endDate },
    };

    const totalWorkEntries = await prisma.workEntry.count({
      where: whereCondition,
    });

    const workEntries = await prisma.workEntry.findMany({
      where: whereCondition,
      include: {
        site: { select: { name: true, location: true } },
        worker: { select: { name: true, email: true } },
      },
      orderBy: { date: "desc" },
      skip,
      take,
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

    res.status(200).json({
      success: true,
      data: report,
      pagination: {
        currentPage: Number(page),
        itemsPerPage: Number(limit),
        totalItems: totalWorkEntries,
        totalPages: Math.ceil(totalWorkEntries / Number(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching work entry status report",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// ----------------------------------------------------------------------
// 5. Company‑wide Report (date‑range)
// ----------------------------------------------------------------------
export const getCompanyReport = async (req: Request, res: Response) => {
  try {
    const { startDate: startStr, endDate: endStr } = req.body;
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

    // Use createdAt for payment date range
    const payments = await prisma.payment.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },

      select: {
        totalAmount: true,
        status: true,

        _count: {
          select: {
            workEntries: true,
          },
        },
      },
    });
    const totalPaidAmount = payments
      .filter((p) => p.status === "PAID")
      .reduce((sum, p) => sum + p.totalAmount, 0);
    const totalApprovedAmount = payments
      .filter((p) => p.status === "APPROVED")
      .reduce((sum, p) => sum + p.totalAmount, 0);
    const totalRejectedAmount = payments
      .filter((p) => p.status === "REJECTED")
      .reduce((sum, p) => sum + p.totalAmount, 0);
    const totalReviewAmount = payments
      .filter((p) => p.status === "REVIEW")
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
        totalApprovedAmount,
        totalRejectedAmount,
        totalPendingAmount,
        totalReviewAmount,
      },
      siteBreakdown: formattedSiteBreakdown,
    });
  } catch (error: any) {
    console.error("Company report error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------------------------
// 6. Site‑specific Report (date‑range)
// ----------------------------------------------------------------------
export const getSiteReport = async (req: Request, res: Response) => {
  try {
    const { siteId } = req.params;
    const { startDate: startStr, endDate: endStr } = req.body;

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
      where: { id: siteId as string },
      select: { id: true, name: true, location: true },
    });
    if (!site) {
      return res
        .status(404)
        .json({ success: false, message: "Site not found" });
    }

    const workEntries = await prisma.workEntry.findMany({
      where: {
        siteId: siteId as string,
        date: { gte: startDate, lte: endDate },
      },
    });

    const totalHours = workEntries.reduce((sum, e) => sum + e.hours, 0);
    const totalOvertime = workEntries.reduce((sum, e) => sum + e.overtime, 0);
    const uniqueWorkers = new Set(workEntries.map((e) => e.workerId)).size;

    const payments = await prisma.payment.findMany({
      where: {
        siteId: siteId as string,
        createdAt: { gte: startDate, lte: endDate },
      },
      select: { totalAmount: true, status: true },
    });

    const totalPaidAmount = payments
      .filter((p) => p.status === "PAID")
      .reduce((sum, p) => sum + p.totalAmount, 0);
    const totalApprovedAmount = payments
      .filter((p) => p.status === "APPROVED")
      .reduce((sum, p) => sum + p.totalAmount, 0);
    const totalRejectedAmount = payments
      .filter((p) => p.status === "REJECTED")
      .reduce((sum, p) => sum + p.totalAmount, 0);
    const totalReviewAmount = payments
      .filter((p) => p.status === "REVIEW")
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
        totalApprovedAmount,
        totalRejectedAmount,
        totalReviewAmount,
      },
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
    const {
      siteId,
      startDate: startStr,
      endDate: endStr,
      page = 1,
      limit = 10,
    } = req.body;

    const { startDate, endDate } = validateDateRange(
      startStr as string,
      endStr as string,
    );
    const { take, skip } = getPagination(Number(page), Number(limit));

    // ---- Common base parameters (always present) ----
    const baseParams: any[] = [startDate, endDate];
    let siteCondition = "";
    let paymentSiteCondition = "";
    let siteParamIndex = 3; // next index after startDate ($1) and endDate ($2)

    if (siteId) {
      siteCondition = `AND "siteId" = $${siteParamIndex}`;
      paymentSiteCondition = `AND "siteId" = $${siteParamIndex}`;
      baseParams.push(String(siteId));
      siteParamIndex++;
    }

    // 1. OVERALL TOTALS (no pagination, just aggregates)
    const overallAgg = await prisma.$queryRawUnsafe<
      Array<{
        totalHours: number;
        totalOvertime: number;
        totalWorkEntries: bigint;
        totalWorkers: bigint;
      }>
    >(
      `SELECT 
        COALESCE(SUM("hours"), 0)::double precision as "totalHours",
        COALESCE(SUM("overtime"), 0)::double precision as "totalOvertime",
        COUNT("id") as "totalWorkEntries",
        COUNT(DISTINCT "workerId") as "totalWorkers"
      FROM "WorkEntry"
      WHERE "date" >= $1 AND "date" <= $2 ${siteCondition}`,
      ...baseParams,
    );

    const overallTotals = {
      totalHours: Number(overallAgg[0]?.totalHours ?? 0),
      totalOvertime: Number(overallAgg[0]?.totalOvertime ?? 0),
      totalWorkers: Number(overallAgg[0]?.totalWorkers ?? 0),
      totalWorkEntries: Number(overallAgg[0]?.totalWorkEntries ?? 0),
    };

    if (overallTotals.totalWorkers === 0) {
      return res.json({
        success: true,
        dateRange: { startDate, endDate },
        filters: { siteId: siteId || null },
        overallTotals,
        workers: [],
        pagination: {
          currentPage: Number(page),
          itemsPerPage: Number(limit),
          totalItems: 0,
          totalPages: 0,
        },
      });
    }

    // ==================================================
    // 2. PAGINATED WORKER AGGREGATION (only workers for current page)
    // ==================================================
    // Parameters for work query: baseParams + take + skip
    const workQueryParams = [...baseParams, take, skip];
    const workAggregation = await prisma.$queryRawUnsafe<
      Array<{
        workerId: string;
        totalHours: number;
        totalOvertime: number;
        workEntriesCount: bigint;
        sitesWorkedCount: bigint;
      }>
    >(
      `SELECT 
        "workerId",
        SUM("hours")::double precision as "totalHours",
        SUM("overtime")::double precision as "totalOvertime",
        COUNT("id") as "workEntriesCount",
        COUNT(DISTINCT "siteId") as "sitesWorkedCount"
      FROM "WorkEntry"
      WHERE "date" >= $1 AND "date" <= $2 ${siteCondition}
      GROUP BY "workerId"
      ORDER BY "workerId"
      LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}`,
      ...workQueryParams,
    );

    if (!workAggregation.length) {
      return res.json({
        success: true,
        dateRange: { startDate, endDate },
        filters: { siteId: siteId || null },
        overallTotals,
        workers: [],
        pagination: {
          currentPage: Number(page),
          itemsPerPage: Number(limit),
          totalItems: overallTotals.totalWorkers,
          totalPages: Math.ceil(overallTotals.totalWorkers / Number(limit)),
        },
      });
    }

    const workerIds = workAggregation.map((w) => w.workerId);

    // ==================================================
    // 3. WORKER DETAILS (only for paginated workers)
    // ==================================================
    const workersDetails = await prisma.user.findMany({
      where: { id: { in: workerIds } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        wageRating: true,
      },
    });

    const workerDetailsMap = new Map(workersDetails.map((w) => [w.id, w]));

    // 4. PAYMENT AGGREGATION (only for paginated workers)
    //    Includes both count and total amount per status
    // Parameters for payment query: baseParams (date + optional site) + workerIds array
    const paymentParams = [...baseParams, workerIds];
    const workerIdsParamIndex = baseParams.length + 1;

    const paymentAggregation = await prisma.$queryRawUnsafe<
      Array<{
        workerId: string;
        status: string;
        totalAmount: number;
        count: bigint;
      }>
    >(
      `SELECT 
        "workerId",
        "status",
        SUM("totalAmount") as "totalAmount",
        COUNT(*) as count
      FROM "Payment"
      WHERE "createdAt" >= $1 AND "createdAt" <= $2 ${paymentSiteCondition}
        AND "workerId" = ANY($${workerIdsParamIndex}::text[])
      GROUP BY "workerId", "status"`,
      ...paymentParams,
    );

    // Build payment summary map: workerId -> { status: { count, amount } }
    const paymentSummaryMap = new Map<
      string,
      Record<string, { count: number; amount: number }>
    >();

    for (const p of paymentAggregation) {
      if (!paymentSummaryMap.has(p.workerId)) {
        paymentSummaryMap.set(p.workerId, {
          PAID: { count: 0, amount: 0 },
          PENDING: { count: 0, amount: 0 },
          APPROVED: { count: 0, amount: 0 },
          REVIEW: { count: 0, amount: 0 },
          REJECTED: { count: 0, amount: 0 },
        });
      }
      const summary = paymentSummaryMap.get(p.workerId)!;
      const status = p.status as keyof typeof summary;
      if (status in summary) {
        summary[status].count = Number(p.count);
        summary[status].amount = Number(p.totalAmount);
      }
    }

    // 5. BUILDING FINAL WORKERS ARRAY (paginated)
    const workersSummary = workAggregation
      .map((work) => {
        const details = workerDetailsMap.get(work.workerId);
        if (!details) return null;
        const paymentSummary = paymentSummaryMap.get(work.workerId) || {
          PAID: { count: 0, amount: 0 },
          PENDING: { count: 0, amount: 0 },
          APPROVED: { count: 0, amount: 0 },
          REVIEW: { count: 0, amount: 0 },
          REJECTED: { count: 0, amount: 0 },
        };
        return {
          workerId: work.workerId,
          workerName: details.name,
          workerEmail: details.email,
          workerRole: details.role,
          workerPhone: details.phone,
          wageRating: details.wageRating,
          totalHours: Number(work.totalHours),
          totalOvertime: Number(work.totalOvertime),
          sitesWorkedCount: Number(work.sitesWorkedCount),
          sitesWorked: [], // not fetched – requires separate query if needed
          workEntriesCount: Number(work.workEntriesCount),
          paymentSummary,
        };
      })
      .filter(Boolean);

    res.json({
      success: true,
      dateRange: { startDate, endDate },
      filters: { siteId: siteId || null },
      overallTotals,
      workers: workersSummary,
      pagination: {
        currentPage: Number(page),
        itemsPerPage: Number(limit),
        totalItems: overallTotals.totalWorkers,
        totalPages: Math.ceil(overallTotals.totalWorkers / Number(limit)),
      },
    });
  } catch (error: any) {
    console.error("Workers summary error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};
