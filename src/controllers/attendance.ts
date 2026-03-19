import e, { type Request, type Response } from "express";
import prisma from "../../prisma/config.js";

type Role = "OWNER" | "FOREMAN" | "WORKER" | "LABORER";

// Extend Express Request interface to include user
interface AuthRequest extends Request {
  user?: {
    id: string;
    role: Role;
  };
}

// Types for request bodies
interface CreateWorkEntryBody {
  workerId: string;
  siteId: string;
  date?: string;
  hours: number | string;
  overtime?: number | string;
  notes?: string;
}

interface UpdateWorkEntryBody {
  hours?: number | string;
  overtime?: number | string;
  notes?: string;
  date?: string;
}

interface BulkWorkEntry {
  workerId: string;
  siteId: string;
  hours: number | string;
  overtime?: number | string;
  date?: string;
  notes?: string;
}

interface BulkCreateBody {
  entries: BulkWorkEntry[];
}

// type MonthStatus = "OPENED" | "LOCKED";
export const recordAttendance = async (req: Request, res: Response) => {
  const { workerId, siteId, date, hours, notes, overtime } = req.body;
  try {
    if (!workerId || !siteId || !date || !hours) {
      res.status(200).json({
        status: "missing_fields",
        message: "Worker ID, Site ID, Date, and Hours are required.",
      });
      return;
    }
    // checking for user existence
    const worker = await prisma.user.findUnique({
      where: { id: workerId },
    });
    if (!worker) {
      res.status(200).json({
        status: "worker_not_found",
        message: "Worker not found.",
      });
      return;
    }

    // checking for site existence and if the worker is belonging to the site
    const site = await prisma.site.findFirst({
      where: { id: siteId },
      include: {
        workers: {
          where: { workerId },
        },
      },
    });

    if (!site) {
      res.status(200).json({
        status: "site_not_found",
        message: "Site not found.",
      });
      return;
    }

    if (site.workers.length === 0) {
      res.status(200).json({
        status: "not_assigned_to_site",
        message: "Worker is not assigned to the specified site.",
      });
      return;
    }

    const workEntry = await prisma.workEntry.create({
      data: {
        workerId,
        siteId,
        date,
        hours: parseInt(hours, 10),
        notes,
        overtime: overtime ? parseInt(overtime, 10) : 0,
      },
    });

    res.status(200).json({
      status: "success",
      message: "Attendance recorded successfully.",
    });
  } catch (error) {
    console.log("error while recording attendance", error);
    res.status(500).json({
      status: "failed",
      massage: "An error occured while recording attendance.",
    });
  }
};

export const todayAttendace = async (req: Request, res: Response) => {
  const { siteId, date } = req.body;

  const startOfDay = date ? new Date(date) : new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = date ? new Date(date) : new Date();
  endOfDay.setHours(23, 59, 59, 999);

  try {
    const presentWorkers = await prisma.workEntry.findMany({
      where: {
        siteId: siteId,
        date: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      select: {
        workerId: true,
        id: true,
      },
      distinct: ["workerId"],
    });

    if (!presentWorkers) {
      res.status(200).json({
        status: "no attandace record found",
        message: "no attendace  record found ",
      });
      return;
    }

    // const todayWorkers = presentWorkers.map((w) => w.workerId);
    const todayWorkers = presentWorkers;

    res.status(200).json({
      message: "attandance list for today retrieved successfully",
      status: "success",
      presentWorkers: todayWorkers,
    });
  } catch (error) {
    console.log("error while getting daily attendance: ", error);
    res
      .status(500)
      .json({ message: " internal server error ", status: "error" });
  }
};

// Create a new work entry (record attendance)
export const createWorkEntry = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const { workerId, siteId, date, hours, overtime, notes } =
      req.body as CreateWorkEntryBody;
    const userId = req.user?.id;

    // if (!userId) {
    //   return res.status(401).json({
    //     success: false,
    //     message: "Unauthorized",
    //   });
    // }

    // Validate required fields
    if (!workerId || !siteId || !hours) {
      return res.status(400).json({
        success: false,
        message: "Worker ID, Site ID, and hours are required",
      });
    }

    const parsedHours = parseFloat(hours as string);
    const siteWorker = await prisma.siteWorker.findUnique({
      where: {
        siteId_workerId: {
          siteId,
          workerId,
        },
      },
    });

    if (!siteWorker) {
      return res.status(400).json({
        success: false,
        message: "Worker is not assigned to this site",
        status: "No for this site",
      });
    }

    // Check for existing entry on the same day
    const entryDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(entryDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(entryDate);
    endOfDay.setHours(23, 59, 59, 999);

    const existingEntry = await prisma.workEntry.findFirst({
      where: {
        workerId,
        siteId,
        date: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    if (existingEntry) {
      return res.status(200).json({
        success: false,
        message: "Work entry already exists for this worker on this day",
        status: "Attandance updated already",
      });
    }

    // Create work entry
    const workEntry = await prisma.workEntry.create({
      data: {
        workerId,
        siteId,
        date: entryDate,
        hours: parsedHours,
        overtime: overtime ? parseFloat(overtime as string) : 0,
        notes,
      },
      include: {
        worker: {
          select: {
            id: true,
            name: true,
            email: true,
            job: true,
            wageRating: true,
          },
        },
        site: {
          select: {
            id: true,
            name: true,
            location: true,
          },
        },
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: "",
        action: "CREATE",
        entity: "WORK_ENTRY",
        entityId: workEntry.id,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Work entry created successfully",
      data: workEntry,
    });
  } catch (error) {
    console.error("Error creating work entry:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create work entry",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Update an existing work entry
export const updateWorkEntry = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { hours, overtime, notes, date } = req.body as UpdateWorkEntryBody;
    const userId = req.user?.id;

    // if (!userId) {
    //   return res.status(401).json({
    //     success: false,
    //     message: "Unauthorized",
    //   });
    // }

    // Check if work entry exists
    const existingEntry = await prisma.workEntry.findUnique({
      where: { id },
      include: {
        site: true,
      },
    });

    if (!existingEntry) {
      return res.status(404).json({
        success: false,
        message: "Work entry not found",
        status: "Entry not found",
      });
    }

    // Check if the month is closed for this site
    const entryDate = date ? new Date(date) : existingEntry.date;
    const monthClose = await prisma.monthClose.findUnique({
      where: {
        siteId_month_year: {
          siteId: existingEntry.siteId,
          month: entryDate.getMonth() + 1,
          year: entryDate.getFullYear(),
        },
      },
    });

    if (monthClose && monthClose.status === "LOCKED") {
      return res.status(403).json({
        success: false,
        message: "Cannot update work entry from a locked month",
        status: "locked month",
      });
    }

    // Update work entry
    const updatedEntry = await prisma.workEntry.update({
      where: { id },
      data: {
        hours: hours ? parseFloat(hours as string) : undefined,
        overtime:
          overtime !== undefined ? parseFloat(overtime as string) : undefined,
        notes: notes !== undefined ? notes : undefined,
        date: date ? new Date(date) : undefined,
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: "",
        action: "UPDATE",
        entity: "WORK_ENTRY",
        entityId: id,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Work entry updated successfully",
      status: "success",
    });
  } catch (error) {
    console.error("Error updating work entry:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update work entry",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Delete a work entry
export const deleteWorkEntry = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const userId = req.user?.id;

    // if (!userId) {
    //   return res.status(401).json({
    //     success: false,
    //     message: "Unauthorized",
    //   });
    // }

    // Check if work entry exists
    const existingEntry = await prisma.workEntry.findUnique({
      where: { id },
    });

    if (!existingEntry) {
      return res.status(404).json({
        success: false,
        message: "Work entry not found",
        status: "Work entry not found",
      });
    }

    // Check if the month is closed for this site
    const entryDate = new Date(existingEntry.date);
    const monthClose = await prisma.monthClose.findUnique({
      where: {
        siteId_month_year: {
          siteId: existingEntry.siteId,
          month: entryDate.getMonth() + 1,
          year: entryDate.getFullYear(),
        },
      },
    });

    if (monthClose && monthClose.status === "LOCKED") {
      return res.status(200).json({
        success: false,
        message: "Cannot delete work entry from a locked month",
        status: "locked month",
      });
    }

    // Delete work entry
    await prisma.workEntry.delete({
      where: { id },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: "",
        action: "DELETE",
        entity: "WORK_ENTRY",
        entityId: id,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Work entry deleted successfully",
      status: "success",
    });
  } catch (error) {
    console.error("Error deleting work entry:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete work entry",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Get work entries for a specific worker
export const getWorkerWorkEntries = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const { workerId } = req.params;
    const { startDate, endDate, siteId } = req.query;

    // Build filter conditions
    const where: any = {
      workerId,
    };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate as string);
      if (endDate) where.date.lte = new Date(endDate as string);
    }

    if (siteId) {
      where.siteId = siteId as string;
    }

    const workEntries = await prisma.workEntry.findMany({
      where,
      include: {
        site: {
          select: {
            id: true,
            name: true,
            location: true,
          },
        },
      },
      orderBy: {
        date: "desc",
      },
    });

    // Calculate totals
    const totals = workEntries.reduce(
      (acc, entry) => ({
        totalHours: acc.totalHours + entry.hours,
        totalOvertime: acc.totalOvertime + entry.overtime,
      }),
      { totalHours: 0, totalOvertime: 0 },
    );

    return res.status(200).json({
      success: true,
      data: workEntries,
      totals,
    });
  } catch (error) {
    console.error("Error fetching work entries:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch work entries",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Get work entries for a specific site
export const getSiteWorkEntries = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const { siteId } = req.params;
    const { date } = req.query;

    const where: any = {
      siteId,
    };

    if (date) {
      const searchDate = new Date(date as string);
      const startOfDay = new Date(searchDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(searchDate);
      endOfDay.setHours(23, 59, 59, 999);

      where.date = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }

    const workEntries = await prisma.workEntry.findMany({
      where,
      include: {
        worker: {
          select: {
            id: true,
            name: true,
            job: true,
            wageRating: true,
          },
        },
      },
      orderBy: {
        date: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      data: workEntries,
    });
  } catch (error) {
    console.error("Error fetching site work entries:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch site work entries",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Bulk create work entries (for multiple workers)
export const bulkCreateWorkEntries = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const { entries } = req.body as BulkCreateBody;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Entries array is required and cannot be empty",
      });
    }

    const createdEntries = [];
    const errors: Array<{ workerId?: string; message: string; entry?: any }> =
      [];

    // Process each entry
    for (const entry of entries) {
      try {
        const { workerId, siteId, hours, overtime, date, notes } = entry;

        // Validate worker is assigned to site
        const siteWorker = await prisma.siteWorker.findUnique({
          where: {
            siteId_workerId: {
              siteId,
              workerId,
            },
          },
        });

        if (!siteWorker) {
          errors.push({
            workerId,
            message: "Worker not assigned to this site",
          });
          continue;
        }

        // Check for duplicate
        const entryDate = date ? new Date(date) : new Date();
        const startOfDay = new Date(entryDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(entryDate);
        endOfDay.setHours(23, 59, 59, 999);

        const existingEntry = await prisma.workEntry.findFirst({
          where: {
            workerId,
            siteId,
            date: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
        });

        if (existingEntry) {
          errors.push({
            workerId,
            message: "Entry already exists for this day",
          });
          continue;
        }

        // Create entry
        const workEntry = await prisma.workEntry.create({
          data: {
            workerId,
            siteId,
            date: entryDate,
            hours: parseFloat(hours as string),
            overtime: overtime ? parseFloat(overtime as string) : 0,
            notes,
          },
        });

        createdEntries.push(workEntry);
      } catch (error) {
        errors.push({
          entry,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Log activity
    if (createdEntries.length > 0) {
      await prisma.activityLog.create({
        data: {
          userId,
          action: "BULK_CREATE",
          entity: "WORK_ENTRY",
          entityId: "bulk",
        },
      });
    }

    return res.status(201).json({
      success: true,
      message: `Created ${createdEntries.length} entries with ${errors.length} errors`,
      data: createdEntries,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error bulk creating work entries:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create work entries",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
