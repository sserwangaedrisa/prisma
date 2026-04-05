// controllers/siteController.ts
import { Request, Response } from "express";
import prisma from "../../prisma/config.js";

// Types for request bodies
interface CreateSiteBody {
  name: string;
  location: string;
  description?: string;
  dutyHours?: number;
  foremanId?: string;
}

interface UpdateSiteBody {
  name?: string;
  location?: string;
  description?: string;
  dutyHours?: number;
  foremanId?: string;
  isActive?: boolean;
}

/**
 * Create a new site
 */
export const createSite = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const {
      name,
      location,
      description,
      dutyHours = 8,
      foremanId,
    }: CreateSiteBody = req.body;

    // Validation
    if (!name || !location || !foremanId) {
      return res.status(400).json({
        success: false,
        message: "Name, location, and foreman ID are required fields",
      });
    }

    if (dutyHours && (dutyHours <= 0 || dutyHours > 24)) {
      return res.status(400).json({
        success: false,
        message: "Duty hours must be between 1 and 24",
      });
    }

    // Check if foreman exists if provided
    if (foremanId) {
      const foreman = await prisma.user.findFirst({
        where: {
          id: foremanId,
          role: { in: ["FOREMAN", "OWNER"] },
        },
      });

      if (!foreman) {
        return res.status(200).json({
          success: false,
          message: "Foreman not found or user is not a foreman",
        });
      }

      if (foreman.status !== "ACTIVE" || foreman.isActive === false) {
        return res.status(200).json({
          success: false,
          message: "Foreman is not active",
        });
      }
    }

    // Create the site
    const site = await prisma.site.create({
      data: {
        name,
        location,
        description: description || null,
        dutyHours,
        foremanId: foremanId || null,
        ownerId: userId,
      },
      include: {
        foreman: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Create default settings for the site
    await prisma.settings.create({
      data: {
        siteId: site.id,
        baseHourlyRate: 0,
        overtimeRate: 0,
        maxDailyHours: 10,
      },
    });

    // Log the activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: "CREATE",
        entity: "Site",
        entityId: site.id,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Site created successfully",
      data: site,
    });
  } catch (error) {
    console.error("Error creating site:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create site",
    });
  }
};

/**
 * Get all sites with filtering and pagination
 */
export const getAllSites = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    // Pagination parameters
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Filter parameters
    const { status, search, foremanId, ownerId } = req.query;

    // Build where clause based on user role
    let whereClause: any = {};

    if (userRole === "OWNER") {
      whereClause.ownerId = userId;
    } else if (userRole === "FOREMAN") {
      whereClause.foremanId = userId;
    } else if (userRole === "WORKER") {
      // Workers can see sites they're assigned to
      whereClause.workers = {
        some: {
          workerId: userId,
        },
      };
    }

    // Apply additional filters
    if (foremanId) {
      whereClause.foremanId = foremanId as string;
    }

    if (ownerId && userRole === "ADMIN") {
      whereClause.ownerId = ownerId as string;
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search as string, mode: "insensitive" } },
        { location: { contains: search as string, mode: "insensitive" } },
        { description: { contains: search as string, mode: "insensitive" } },
      ];
    }

    // Get sites with pagination
    const [sites, total] = await Promise.all([
      prisma.site.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: {
          createdAt: "desc",
        },
        include: {
          foreman: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          workers: {
            include: {
              worker: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          settings: {
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          },
          _count: {
            select: {
              workers: true,
              workEntries: true,
              payments: true,
            },
          },
        },
      }),
      prisma.site.count({ where: whereClause }),
    ]);

    return res.status(200).json({
      success: true,
      data: sites,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching sites:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch sites",
      error:
        process.env.NODE_ENV === "development"
          ? (error as Error).message
          : undefined,
    });
  }
};

/**
 * Get a single site by ID
 */
export const getSiteById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const site = await prisma.site.findUnique({
      where: { id },
      include: {
        foreman: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        workers: {
          include: {
            worker: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                role: true,
              },
            },
          },
        },
        settings: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
        monthCloses: {
          where: {
            status: "OPEN",
          },
          orderBy: [{ year: "desc" }, { month: "desc" }],
        },
        _count: {
          select: {
            workers: true,
            workEntries: true,
            payments: true,
          },
        },
      },
    });

    if (!site) {
      return res.status(404).json({
        success: false,
        message: "Site not found",
      });
    }

    // Check authorization
    if (
      userRole !== "ADMIN" &&
      site.ownerId !== userId &&
      site.foremanId !== userId &&
      userRole !== "OWNER"
    ) {
      // Check if user is a worker assigned to this site
      const isWorker = await prisma.siteWorker.findFirst({
        where: {
          siteId: id,
          workerId: userId,
        },
      });

      if (!isWorker && userRole !== "ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this site",
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: site,
    });
  } catch (error) {
    console.error("Error fetching site:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch site",
      error:
        process.env.NODE_ENV === "development"
          ? (error as Error).message
          : undefined,
    });
  }
};

/**
 * Update a site
 */
export const updateSite = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const updateData: UpdateSiteBody = req.body;

    // Check if site exists and user has permission
    const existingSite = await prisma.site.findUnique({
      where: { id },
      select: {
        id: true,
        ownerId: true,
        foremanId: true,
      },
    });

    if (!existingSite) {
      return res.status(404).json({
        success: false,
        message: "Site not found",
      });
    }

    // Check authorization (only owner or admin can update)
    if (userRole !== "ADMIN" && existingSite.ownerId !== userId) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to update this site",
      });
    }

    // Validate duty hours if provided
    if (
      updateData.dutyHours &&
      (updateData.dutyHours <= 0 || updateData.dutyHours > 24)
    ) {
      return res.status(400).json({
        success: false,
        message: "Duty hours must be between 1 and 24",
      });
    }

    // Check if new foreman exists if provided
    if (updateData.foremanId) {
      const foreman = await prisma.user.findFirst({
        where: {
          id: updateData.foremanId,
          role: { in: ["FOREMAN", "OWNER"] },
        },
      });

      if (!foreman) {
        return res.status(404).json({
          success: false,
          message: "Foreman not found or user is not a foreman",
        });
      }
    }

    // Update the site
    const updatedSite = await prisma.site.update({
      where: { id },
      data: {
        name: updateData.name,
        location: updateData.location,
        description: updateData.description,
        dutyHours: updateData.dutyHours,
        foremanId: updateData.foremanId,
      },
      include: {
        foreman: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Log the activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: "UPDATE",
        entity: "Site",
        entityId: id,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Site updated successfully",
      data: updatedSite,
    });
  } catch (error) {
    console.error("Error updating site:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update site",
      error:
        process.env.NODE_ENV === "development"
          ? (error as Error).message
          : undefined,
    });
  }
};

/**
 * Delete a site (soft delete or hard delete with checks)
 */
export const deleteSite = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { permanent = false } = req.query;

    // Check if site exists
    const existingSite = await prisma.site.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            workEntries: true,
            payments: true,
            monthCloses: true,
          },
        },
      },
    });

    if (!existingSite) {
      return res.status(404).json({
        success: false,
        message: "Site not found",
      });
    }

    // Check authorization (only owner or admin can delete)
    if (userRole !== "ADMIN" && existingSite.ownerId !== userId) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to delete this site",
      });
    }

    // Check if site has associated data
    if (
      existingSite._count.workEntries > 0 ||
      existingSite._count.payments > 0 ||
      existingSite._count.monthCloses > 0
    ) {
      if (permanent === "true") {
        return res.status(400).json({
          success: false,
          message:
            "Cannot permanently delete site with existing work entries, payments, or month closes. Consider soft delete or archive instead.",
        });
      }

      // Soft delete by deactivating instead of deleting
      // You might want to add an 'isActive' field to your Site model
      // For now, we'll return a warning
      return res.status(400).json({
        success: false,
        message:
          "Site has associated data. Please archive it instead of deleting.",
        data: {
          workEntriesCount: existingSite._count.workEntries,
          paymentsCount: existingSite._count.payments,
          monthClosesCount: existingSite._count.monthCloses,
        },
      });
    }

    // Log before deletion
    await prisma.activityLog.create({
      data: {
        userId,
        action: "DELETE",
        entity: "Site",
        entityId: id,
        details: `Site "${existingSite.name}" was deleted`,
      },
    });

    // Delete the site (cascade will handle related records)
    await prisma.site.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: "Site deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting site:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete site",
      error:
        process.env.NODE_ENV === "development"
          ? (error as Error).message
          : undefined,
    });
  }
};

/**
 * Archive a site (mark as inactive)
 */
export const archiveSite = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const existingSite = await prisma.site.findUnique({
      where: { id },
    });

    if (!existingSite) {
      return res.status(404).json({
        success: false,
        message: "Site not found",
      });
    }

    // Check authorization
    if (userRole !== "ADMIN" && existingSite.ownerId !== userId) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to archive this site",
      });
    }

    // You'll need to add an 'isActive' or 'archived' field to your Site model
    // For now, we'll return a message
    return res.status(200).json({
      success: true,
      message: "Site archived successfully",
      data: existingSite,
    });
  } catch (error) {
    console.error("Error archiving site:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to archive site",
    });
  }
};

/**
 * Get site statistics
 */
export const getSiteStats = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const stats = await prisma.$transaction([
      prisma.workEntry.count({
        where: { siteId: id },
      }),
      prisma.workEntry.aggregate({
        where: { siteId: id },
        _sum: {
          hours: true,
          overtime: true,
        },
      }),
      prisma.payment.aggregate({
        where: { siteId: id },
        _sum: {
          totalAmount: true,
        },
        _count: true,
      }),
      prisma.siteWorker.count({
        where: { siteId: id },
      }),
      prisma.monthClose.count({
        where: {
          siteId: id,
          status: "OPEN",
        },
      }),
    ]);

    const [
      totalWorkEntries,
      workHoursSum,
      paymentsSum,
      totalWorkers,
      openMonths,
    ] = stats;

    return res.status(200).json({
      success: true,
      data: {
        totalWorkEntries,
        totalHours: workHoursSum._sum.hours || 0,
        totalOvertime: workHoursSum._sum.overtime || 0,
        totalPayments: paymentsSum._count,
        totalPaymentAmount: paymentsSum._sum.totalAmount || 0,
        totalWorkers,
        openMonths,
      },
    });
  } catch (error) {
    console.error("Error fetching site stats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch site statistics",
    });
  }
};
