import prisma from "../../prisma/config";
import { Request, Response } from "express";

type Role = "FOREMAN" | "OWNER" | "LABORER" | "WORKER";
// Extend Express Request interface to include user
interface AuthRequest extends Request {
  user?: {
    id: string;
    role: Role;
  };
}

// Get the most recent settings
export const getLatestSettings = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  const { siteId } = req.body;
  try {
    const latestSettings = await prisma.settings.findFirst({
      where: {
        siteId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!latestSettings) {
      return res.status(200).json({
        success: true,
        message: "No setting found, create one setting and try again",
      });
    }

    return res.status(200).json({
      success: true,
      data: latestSettings,
    });
  } catch (error) {
    console.error("Error fetching latest settings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch latest settings",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Get settings by date (returns the settings that were active on that date)
export const getSettingsByDate = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const { dateStr, siteId } = req.body;
    if (!dateStr) {
      return res.status(200).json({
        success: false,
        message: "Date parameter is required",
      });
    }

    const targetDate = new Date(dateStr);

    // Validate date
    if (isNaN(targetDate.getTime())) {
      return res.status(200).json({
        success: false,
        message: "Invalid date format",
      });
    }

    // Find the settings that were active on this date
    // (created on or before the target date, ordered by most recent)
    const settings = await prisma.settings.findFirst({
      where: {
        siteId,
        createdAt: {
          lte: targetDate,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!settings) {
      // If no settings found for that date, get the earliest settings
      const earliestSettings = await prisma.settings.findFirst({
        where: {
          siteId,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      if (!earliestSettings) {
        // If no settings exist at all, create default

        return res.status(200).json({
          success: false,
          message:
            "No settings for given date and no default settin. Create a default setting",
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "No settings found for this date, showing default settings available",
        data: earliestSettings,
      });
    }

    return res.status(200).json({
      success: true,
      message: "settings successfully obtained",
      data: settings,
    });
  } catch (error) {
    console.error("Error fetching settings by date:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch settings by date",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Create new settings
export const createSettings = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const { siteId, overtimeRate, maxDailyHours, baseHourlyRate, createdAt } =
      req.body;
    console.log("creadedAt: ", createdAt);

    if (!siteId) {
      return res.status(200).json({
        success: false,
        message: "siteID not found, refresh the page and try again",
      });
    }

    if (
      overtimeRate === undefined ||
      maxDailyHours === undefined ||
      baseHourlyRate === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Overtime rate, max daily hours, and base hourly rate are required",
      });
    }

    // Parse and validate values
    const parsedOvertimeRate = parseFloat(overtimeRate as string);
    const parsedMaxDailyHours = parseFloat(maxDailyHours as string);
    const parsedBaseHourlyRate = parseFloat(baseHourlyRate as string);

    if (isNaN(parsedOvertimeRate)) {
      return res.status(200).json({
        success: false,
        message: "Overtime rate must be a number between 1 and 3",
      });
    }

    if (
      isNaN(parsedMaxDailyHours) ||
      parsedMaxDailyHours < 1 ||
      parsedMaxDailyHours > 24
    ) {
      return res.status(200).json({
        success: false,
        message: "Max daily hours must be a number between 1 and 24",
      });
    }

    if (isNaN(parsedBaseHourlyRate) || parsedBaseHourlyRate < 0) {
      return res.status(400).json({
        success: false,
        message: "Base hourly rate must be a positive number",
      });
    }

    // Create new settings
    const newSettings = await prisma.settings.create({
      data: {
        siteId,
        createdAt: new Date(createdAt),
        overtimeRate: parsedOvertimeRate,
        maxDailyHours: parsedMaxDailyHours,
        baseHourlyRate: parsedBaseHourlyRate,
      },
    });

    if (!newSettings) {
      return res.status(200).json({
        success: false,
        massege: "error while updating the db",
      });
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: req.user?.id,
        action: "CREATE",
        entity: "SETTINGS",
        entityId: newSettings.id,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Settings created successfully",
      data: newSettings,
    });
  } catch (error) {
    console.error("Error creating settings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create settings",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Update existing settings
export const updateSettings = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const { id, overtimeRate, maxDailyHours, baseHourlyRate, createdAt } =
      req.body;
    console.log("creadedAt: ", createdAt);

    const userId = req.user?.id;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Settings ID is required",
      });
    }

    // Check if settings exist
    const existingSettings = await prisma.settings.findUnique({
      where: { id },
    });

    if (!existingSettings) {
      return res.status(200).json({
        success: false,
        message: "Settings not found",
      });
    }

    // Prepare update data
    const updateData: any = {};
    updateData.createdAt = new Date(createdAt);

    if (overtimeRate !== undefined) {
      const parsedOvertimeRate = parseFloat(overtimeRate as string);
      if (isNaN(parsedOvertimeRate)) {
        return res.status(200).json({
          success: false,
          message: "Overtime rate must be a number",
        });
      }
      updateData.overtimeRate = parsedOvertimeRate;
    }

    if (maxDailyHours !== undefined) {
      const parsedMaxDailyHours = parseFloat(maxDailyHours as string);
      if (
        isNaN(parsedMaxDailyHours) ||
        parsedMaxDailyHours < 1 ||
        parsedMaxDailyHours > 24
      ) {
        return res.status(200).json({
          success: false,
          message: "Max daily hours must be a number between 1 and 24",
        });
      }
      updateData.maxDailyHours = parsedMaxDailyHours;
    }

    if (baseHourlyRate !== undefined) {
      const parsedBaseHourlyRate = parseFloat(baseHourlyRate as string);
      if (isNaN(parsedBaseHourlyRate) || parsedBaseHourlyRate < 0) {
        return res.status(200).json({
          success: false,
          message: "Base hourly rate must be a positive number",
        });
      }
      updateData.baseHourlyRate = parsedBaseHourlyRate;
    }

    // Check if there are any fields to update
    if (Object.keys(updateData).length === 0) {
      return res.status(200).json({
        success: false,
        message: "No valid fields to update",
      });
    }

    // Update settings
    const updatedSettings = await prisma.settings.update({
      where: { id },
      data: updateData,
    });

    if (!updateSettings) {
      return res.status(500).json({
        success: false,
        massege: "error while updating the db",
      });
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: req.user?.id,
        action: "UPDATE",
        entity: "SETTINGS",
        entityId: id,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Settings updated successfully",
      data: updatedSettings,
    });
  } catch (error) {
    console.error("Error updating settings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update settings",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Get settings history with optional date range
export const getSettingsHistory = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const { siteId, startDateStr, endDateStr } = req.body;

    // Build where clause
    const where: any = {};

    if (startDateStr || endDateStr) {
      where.createdAt = {};

      if (startDateStr) {
        const startDate = new Date(startDateStr);
        if (!isNaN(startDate.getTime())) {
          where.createdAt.gte = startDate;
          where.siteId = siteId;
        }
      }

      if (endDateStr) {
        const endDate = new Date(endDateStr);
        if (!isNaN(endDate.getTime())) {
          // Set to end of day
          endDate.setHours(23, 59, 59, 999);
          where.createdAt.lte = endDate;
        }
      }
    }

    // Get settings history
    const settingsHistory = await prisma.settings.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      data: settingsHistory,
      count: settingsHistory.length,
    });
  } catch (error) {
    console.error("Error fetching settings history:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch settings history",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Delete settings (optional - use with caution)
export const deleteSettings = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const { id } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!id) {
      return res.status(200).json({
        success: false,
        message: "Settings ID is required",
      });
    }

    // Check if settings exist
    const existingSettings = await prisma.settings.findUnique({
      where: { id },
    });

    if (!existingSettings) {
      return res.status(200).json({
        success: false,
        message: "Settings not found",
      });
    }

    // Check if these are the only settings
    const settingsCount = await prisma.settings.count();

    if (settingsCount === 1) {
      return res.status(200).json({
        success: false,
        message:
          "Cannot delete the defalt settings record. Create new settings first.",
      });
    }

    // Delete settings
    await prisma.settings.delete({
      where: { id },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: "DELETE",
        entity: "SETTINGS",
        entityId: id,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Settings deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting settings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete settings",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Compare settings between two dates
export const compareSettings = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const { date1Str, date2Str } = req.body;

    if (!date1Str || !date2Str) {
      return res.status(400).json({
        success: false,
        message: "Both date1 and date2 parameters are required",
      });
    }

    const date1 = new Date(date1Str);
    const date2 = new Date(date2Str);

    if (isNaN(date1.getTime()) || isNaN(date2.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
    }

    // Get settings for date1
    const settings1 = await prisma.settings.findFirst({
      where: {
        createdAt: {
          lte: date1,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Get settings for date2
    const settings2 = await prisma.settings.findFirst({
      where: {
        createdAt: {
          lte: date2,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!settings1 || !settings2) {
      return res.status(404).json({
        success: false,
        message: "Settings not found for one or both dates",
      });
    }

    // Calculate differences
    const comparison = {
      date1: {
        date: date1Str,
        settings: settings1,
      },
      date2: {
        date: date2Str,
        settings: settings2,
      },
      differences: {
        overtimeRate: settings2.overtimeRate - settings1.overtimeRate,
        maxDailyHours: settings2.maxDailyHours - settings1.maxDailyHours,
        baseHourlyRate: settings2.baseHourlyRate - settings1.baseHourlyRate,
        daysBetween: Math.floor(
          (date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24),
        ),
      },
    };

    return res.status(200).json({
      success: true,
      data: comparison,
    });
  } catch (error) {
    console.error("Error comparing settings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to compare settings",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
