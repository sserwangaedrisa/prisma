import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Report controller to provide insights on payments and work entries across sites
// Get site summaries with payment and workEntry statuses
export const getSiteSummaries = async (req: Request, res: Response) => {
  try {
    const sites = await prisma.site.findMany({
      include: {
        payments: {
          select: {
            status: true,
            amount: true,
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
      const paymentStatuses = {
        pending: 0,
        paid: 0,
        cancelled: 0,
        overdue: 0,
      };
      let totalAmount = 0;

      site.payments.forEach((payment) => {
        if (payment.status in paymentStatuses) {
          paymentStatuses[payment.status as keyof typeof paymentStatuses]++;
        }
        totalAmount += payment.amount || 0;
      });

      const workEntryStatuses = {
        pending: 0,
        completed: 0,
        inProgress: 0,
        cancelled: 0,
      };

      site.workEntries.forEach((entry) => {
        if (entry.status in workEntryStatuses) {
          workEntryStatuses[entry.status as keyof typeof workEntryStatuses]++;
        }
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
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching site summaries",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Get monthly comparison for statistics
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
        createdAt: {
          gte: startDate,
          lte: currentDate,
        },
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const workEntryData = await prisma.workEntry.groupBy({
      by: ["createdAt", "status"],
      where: {
        ...(siteId && { siteId: String(siteId) }),
        createdAt: {
          gte: startDate,
          lte: currentDate,
        },
      },
      _count: true,
    });

    // Organize data by month
    const monthlyStats: Record<string, any> = {};

    paymentData.forEach((record) => {
      const monthKey = new Date(record.createdAt).toISOString().slice(0, 7);
      if (!monthlyStats[monthKey]) {
        monthlyStats[monthKey] = {
          payments: {},
          workEntries: {},
        };
      }
      monthlyStats[monthKey].payments[record.status] = {
        count: record._count,
        total: record._sum.amount || 0,
      };
    });

    workEntryData.forEach((record) => {
      const monthKey = new Date(record.createdAt).toISOString().slice(0, 7);
      if (!monthlyStats[monthKey]) {
        monthlyStats[monthKey] = {
          payments: {},
          workEntries: {},
        };
      }
      monthlyStats[monthKey].workEntries[record.status] = {
        count: record._count,
      };
    });

    res.status(200).json({
      success: true,
      data: monthlyStats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching monthly comparison",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Get detailed payment status report
export const getPaymentStatusReport = async (req: Request, res: Response) => {
  try {
    const { siteId } = req.query;

    const payments = await prisma.payment.findMany({
      where: {
        ...(siteId && { siteId: String(siteId) }),
      },
      include: {
        site: {
          select: {
            name: true,
            location: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const groupedByStatus = payments.reduce(
      (acc, payment) => {
        if (!acc[payment.status]) {
          acc[payment.status] = [];
        }
        acc[payment.status].push(payment);
        return acc;
      },
      {} as Record<string, typeof payments>,
    );

    const report = Object.entries(groupedByStatus).map(([status, items]) => ({
      status,
      count: items.length,
      totalAmount: items.reduce((sum, item) => sum + (item.amount || 0), 0),
      payments: items,
    }));

    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching payment status report",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Get detailed workEntry status report
export const getWorkEntryStatusReport = async (req: Request, res: Response) => {
  try {
    const { siteId } = req.query;

    const workEntries = await prisma.workEntry.findMany({
      where: {
        ...(siteId && { siteId: String(siteId) }),
      },
      include: {
        site: {
          select: {
            name: true,
            location: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const groupedByStatus = workEntries.reduce(
      (acc, entry) => {
        if (!acc[entry.status]) {
          acc[entry.status] = [];
        }
        acc[entry.status].push(entry);
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
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching work entry status report",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
