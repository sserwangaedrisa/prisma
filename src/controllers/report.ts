import { Request, Response } from "express";
import prisma from "../../prisma/config.js";
import {
  validateUser,
  validateMonthNotLocked,
} from "../middleware/validation.js";

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
// Define interface for raw SQL aggregation result
interface WorkEntryAggregateRow {
  total_hours: number | string;
  total_overtime: number | string;
  unique_workers: number | string;
  unique_sites: number | string;
  total_amount: number | string;
  site_id: string;
  site_name: string;
  site_hours: number | string;
  site_overtime: number | string;
  site_unique_workers: number | string;
}
type PaymentStatus = "PENDING" | "PAID" | "REVIEW" | "REJECTED" | "APPROVED";

const toNumber = (
  value: number | string | null | undefined | bigint,
): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return parseFloat(value);
  return value;
};
export const getCompanyReport = async (req: Request, res: Response) => {
  try {
    const { startDate: startStr, endDate: endStr } = req.body;
    const { startDate, endDate } = validateDateRange(
      startStr as string,
      endStr as string,
    );

    // 1. Work entries aggregation
    const workAggResult: WorkEntryAggregateRow[] = await prisma.$queryRaw`
      SELECT
        COALESCE(SUM(we.hours), 0) AS total_hours,
        COALESCE(SUM(we.overtime), 0) AS total_overtime,
        COUNT(DISTINCT we."workerId") AS unique_workers,
        COUNT(DISTINCT we."siteId") AS unique_sites,
        COALESCE(SUM(we.amount), 0) AS total_amount,
        we."siteId" AS site_id,
        s.name AS site_name
      FROM "WorkEntry" we
      JOIN "Site" s ON we."siteId" = s.id
      WHERE we.date BETWEEN ${startDate} AND ${endDate}
      GROUP BY we."siteId", s.name
    `;

    // Extract totals from first row (they are identical across all rows)
    const firstRow = workAggResult[0];
    const totalHours = firstRow ? toNumber(firstRow.total_hours) : 0;
    const totalOvertime = firstRow ? toNumber(firstRow.total_overtime) : 0;
    const uniqueWorkers = firstRow ? toNumber(firstRow.unique_workers) : 0;
    const uniqueSites = firstRow ? toNumber(firstRow.unique_sites) : 0;
    const totalAmount = firstRow ? toNumber(firstRow.total_amount) : 0;
    // Build site breakdown with proper number conversion
    const formattedSiteBreakdown = workAggResult.map((row) => ({
      siteId: row.site_id,
      siteName: row.site_name,
      totalHours: toNumber(row.site_hours),
      totalOvertime: toNumber(row.site_overtime),
      uniqueWorkers: toNumber(row.site_unique_workers),
      totalAmount: toNumber(row.total_amount),
    }));

    type PaymentStatus =
      | "PENDING"
      | "PAID"
      | "REVIEW"
      | "REJECTED"
      | "APPROVED";

    // 2. Payments aggregation including both count and sum
    const paymentAgg = await prisma.payment.groupBy({
      by: ["status"],
      where: {
        createdAt: { gte: startDate, lte: endDate },
      },
      _count: true,
      _sum: { totalAmount: true },
    });

    const amountsByStatus: Record<
      PaymentStatus,
      { count: number; amount: number }
    > = {
      PENDING: { count: 0, amount: 0 },
      APPROVED: { count: 0, amount: 0 },
      REVIEW: { count: 0, amount: 0 },
      REJECTED: { count: 0, amount: 0 },
      PAID: { count: 0, amount: 0 },
    };

    for (const item of paymentAgg) {
      amountsByStatus[item.status] = {
        count: toNumber(item._count),
        amount: toNumber(item._sum.totalAmount),
      };
    }
    res.json({
      success: true,
      dateRange: { startDate, endDate },
      summary: {
        totalHours: toNumber(totalHours),
        totalOvertime: toNumber(totalOvertime),
        uniqueWorkers: toNumber(uniqueWorkers),
        uniqueSites: toNumber(uniqueSites),
        totalAmount: toNumber(totalAmount),
        totalPaidAmount: amountsByStatus.PAID,
        totalApprovedAmount: amountsByStatus.APPROVED,
        totalRejectedAmount: amountsByStatus.REJECTED,
        totalPendingAmount: amountsByStatus.PENDING,
        totalReviewAmount: amountsByStatus.REVIEW,
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
// Add these type definitions at the top of your file (or import them)
interface SiteWorkAggregateRow {
  total_hours: number | string;
  total_overtime: number | string;
  total_amount: number | string;
  unique_workers: number | string;
}

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

    // Fetch site details
    const site = await prisma.site.findUnique({
      where: { id: siteId as string },
      select: { id: true, name: true, location: true },
    });

    if (!site) {
      return res
        .status(404)
        .json({ success: false, message: "Site not found" });
    }

    // 1. Work entries aggregation for the specific site
    const workAggResult: SiteWorkAggregateRow[] = await prisma.$queryRaw`
      SELECT
        COALESCE(SUM(we.hours), 0) AS total_hours,
        COALESCE(SUM(we.overtime), 0) AS total_overtime,
        COALESCE(SUM(we.amount), 0 ) AS total_amount,
        COUNT(DISTINCT we."workerId") AS unique_workers
      FROM "WorkEntry" we
      WHERE we."siteId" = ${siteId}
        AND we.date BETWEEN ${startDate} AND ${endDate}
    `;

    const firstRow = workAggResult[0];
    const totalHours = firstRow ? toNumber(firstRow.total_hours) : 0;
    const totalOvertime = firstRow ? toNumber(firstRow.total_overtime) : 0;
    const uniqueWorkers = firstRow ? toNumber(firstRow.unique_workers) : 0;
    const totalAmount = firstRow ? toNumber(firstRow.total_amount) : 0;
    // 2. Payments aggregation (count + sum by status)
    const paymentAgg = await prisma.payment.groupBy({
      by: ["status"],
      where: {
        siteId: siteId as string,
        createdAt: { gte: startDate, lte: endDate },
      },
      _count: true,
      _sum: { totalAmount: true },
    });

    // Build a record with both count and amount per status
    const amountsByStatus: Record<
      PaymentStatus,
      { count: number; amount: number }
    > = {
      PENDING: { count: 0, amount: 0 },
      APPROVED: { count: 0, amount: 0 },
      REVIEW: { count: 0, amount: 0 },
      REJECTED: { count: 0, amount: 0 },
      PAID: { count: 0, amount: 0 },
    };

    for (const item of paymentAgg) {
      amountsByStatus[item.status] = {
        count: toNumber(item._count),
        amount: toNumber(item._sum.totalAmount),
      };
    }

    return res.json({
      success: true,
      site: { id: site.id, name: site.name, location: site.location },
      dateRange: { startDate, endDate },
      summary: {
        totalHours,
        totalOvertime,
        uniqueWorkers,
        totalAmount,
        paymentBreakdown: {
          paid: amountsByStatus.PAID,
          approved: amountsByStatus.APPROVED,
          pending: amountsByStatus.PENDING,
          rejected: amountsByStatus.REJECTED,
          review: amountsByStatus.REVIEW,
        },
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
      search = "",
    } = req.body;

    const { startDate, endDate } = validateDateRange(
      startStr as string,
      endStr as string,
    );
    const { take, skip } = getPagination(Number(page), Number(limit));

    // ---- Base parameters: always startDate & endDate ----
    const baseParams: any[] = [startDate, endDate];
    let siteCondition = "";
    let paymentSiteCondition = "";
    let paramIndex = 3; // next index after $1 and $2

    // Site filter (optional)
    if (siteId) {
      siteCondition = `AND "siteId" = $${paramIndex}`;
      paymentSiteCondition = `AND "siteId" = $${paramIndex}`;
      baseParams.push(String(siteId));
      paramIndex++;
    }

    // Search filter (optional) – matches worker name or email
    let searchCondition = "";
    if (search && search.trim() !== "") {
      const searchPattern = `%${search}%`;
      searchCondition = `AND "workerId" IN (
        SELECT id FROM "User"
        WHERE name ILIKE $${paramIndex} OR email ILIKE $${paramIndex}
      )`;
      baseParams.push(searchPattern);
      paramIndex++;
    }

    // 1. OVERALL TOTALS (respects date, site, AND search)
    const overallAgg = await prisma.$queryRawUnsafe<
      Array<{
        totalHours: number;
        totalOvertime: number;
        totalWorkEntries: bigint;
        totalAmount: number;
        totalWorkers: bigint;
      }>
    >(
      `SELECT 
        COALESCE(SUM("hours"), 0)::double precision as "totalHours",
        COALESCE(SUM("overtime"), 0)::double precision as "totalOvertime",
        COALESCE(SUM("amount"), 0)::double precision as "totalAmount",
        COUNT("id") as "totalWorkEntries",
        COUNT(DISTINCT "workerId") as "totalWorkers"
      FROM "WorkEntry"
      WHERE "date" >= $1 AND "date" <= $2 ${siteCondition} ${searchCondition}`,
      ...baseParams,
    );

    const overallTotals = {
      totalHours: Number(overallAgg[0]?.totalHours ?? 0),
      totalOvertime: Number(overallAgg[0]?.totalOvertime ?? 0),
      totalWorkers: Number(overallAgg[0]?.totalWorkers ?? 0),
      totalWorkEntries: Number(overallAgg[0]?.totalWorkEntries ?? 0),
      totalAmount: Number(overallAgg[0]?.totalAmount ?? 0),
    };

    // Early exit if no workers match
    if (overallTotals.totalWorkers === 0) {
      return res.json({
        success: true,
        dateRange: { startDate, endDate },
        filters: { siteId: siteId || null, search: search || null },
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

    // 2. PAGINATED WORKER AGGREGATION (only workers for current page, respects search)
    const workQueryParams = [...baseParams, take, skip];
    const workAggregation = await prisma.$queryRawUnsafe<
      Array<{
        workerId: string;
        totalHours: number;
        totalOvertime: number;
        workEntriesCount: bigint;
        sitesWorkedCount: bigint;
        totalAmount: number;
      }>
    >(
      `SELECT 
        "workerId",
        SUM("hours")::double precision as "totalHours",
        SUM("overtime")::double precision as "totalOvertime",
        COUNT("id") as "workEntriesCount",
        COUNT(DISTINCT "siteId") as "sitesWorkedCount",
        COALESCE(SUM("amount"), 0)::double precision as "totalAmount"
      FROM "WorkEntry"
      WHERE "date" >= $1 AND "date" <= $2 ${siteCondition} ${searchCondition}
      GROUP BY "workerId"
      ORDER BY "workerId"
      LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}`,
      ...workQueryParams,
    );

    if (!workAggregation.length) {
      return res.json({
        success: true,
        dateRange: { startDate, endDate },
        filters: { siteId: siteId || null, search: search || null },
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

    // 3. WORKER DETAILS (only for paginated workers)
    const workersDetails = await prisma.user.findMany({
      where: { id: { in: workerIds } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        imageUrl: true,
        wageRating: true,
      },
    });

    const workerDetailsMap = new Map<string, (typeof workersDetails)[number]>(
      workersDetails.map((w) => [w.id, w]),
    );

    // 4. PAYMENT AGGREGATION (only for paginated workers – no extra search needed)
    const paymentParams = [
      ...baseParams.slice(0, 2),
      ...(siteId ? [siteId] : []),
      workerIds,
    ];
    const workerIdsParamIndex = baseParams.length - (search ? 1 : 0) + 1; // index of the workerIds array
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

    // Building payment summary map
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

    // 5. BUILD FINAL WORKERS ARRAY (paginated)
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
          totalAmount: Number(work.totalAmount),
          imageUrl: details.imageUrl,
          totalOvertime: Number(work.totalOvertime),
          sitesWorkedCount: Number(work.sitesWorkedCount),
          sitesWorked: [],
          workEntriesCount: Number(work.workEntriesCount),
          paymentSummary,
        };
      })
      .filter(Boolean);

    res.json({
      success: true,
      dateRange: { startDate, endDate },
      filters: { siteId: siteId || null, search: search || null },
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
