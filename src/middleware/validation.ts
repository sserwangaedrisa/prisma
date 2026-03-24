import type { Request, Response, NextFunction } from "express";
import Joi from "joi";
import prisma from "../../prisma/config";

// users start
export const registerUserPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const schema = Joi.object({
    fullName: Joi.string().min(2).required(),
    email: Joi.string().email({ minDomainSegments: 2 }).required(),
  });
  const { fullName, email } = req.body;
  const { error } = schema.validate({ fullName, email });
  if (error) {
    return res.status(500).send({
      message: error.details[0]?.message,
    });
  }
  return next();
};

export const loginUserPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const schema = Joi.object({
    email: Joi.string().email({ minDomainSegments: 2 }).required(),
    password: Joi.string().required(),
  });
  const { email, password } = req.body;

  const { error } = schema.validate({ email, password });
  if (error) {
    return res.status(500).send({
      message: error.details[0]?.message,
    });
  }
  return next();
};

export const forgotPasswordPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const schema = Joi.object({
    email: Joi.string().email({ minDomainSegments: 2 }).required(),
  });
  const { email } = req.body;
  const { error } = schema.validate({ email });
  if (error) {
    return res.status(500).send({
      message: error.details[0]?.message,
    });
  }
  return next();
};

// validation/userValidation.ts

interface UserValidationResult {
  success: boolean;
  message: string;
  data?: {
    id: string;
    status: string;
    isActive: boolean;
    name: string;
    job: string;
    email: string;
    role: string;
    wageRatings: number | null;
  };
}

interface MonthValidationResult {
  success: boolean;
  message: string;
  data?: {
    month: number;
    year: number;
    lockedAt?: Date;
    lockedBy?: string;
  };
}

/**
 * Validates user permissions based on userId
 * @param userId - The ID of the user to validate
 * @returns Object with success status and message
 */
export const validateUser = async (
  userId: string,
): Promise<UserValidationResult> => {
  try {
    if (!userId) {
      return {
        success: false,
        message: "User ID is required",
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        isActive: true,
        role: true,
        wageRating: true,
        job: true,
        name: true,
        email: true,
      },
    });

    if (!user) {
      return {
        success: false,
        message: "User not found",
      };
    }

    // Check user status
    switch (user.status) {
      case "INACTIVE":
        return {
          success: false,
          message: "Account is inactive. Please contact support.",
        };

      case "SUSPENDED":
        return {
          success: false,
          message: "Account is suspended. Please contact support.",
        };

      case "BLOCKED":
        return {
          success: false,
          message: "Account is blocked. Please contact support.",
        };

      case "DELETED":
        return {
          success: false,
          message: "Account has been deleted.",
        };

      case "ACTIVE":
        // Continue to check isActive
        break;

      default:
        return {
          success: false,
          message: "Invalid account status.",
        };
    }

    // Check if account is activated (email verification)
    if (!user.isActive) {
      return {
        success: false,
        message: "Account not activated. Please verify your email.",
      };
    }

    // User is valid
    return {
      success: true,
      message: "User is valid",
      data: {
        id: user.id,
        job: user.job ? user.job : "USER",
        email: user.email,
        name: user.name,
        status: user.status,
        isActive: user.isActive,
        role: user.role,
        wageRatings: user.wageRating,
      },
    };
  } catch (error) {
    console.error("Error validating user:", error);
    return {
      success: false,
      message: "Error validating user",
    };
  }
};

/**
 * Validates if a specific month/year is locked for a site
 * @param siteId - The ID of the site
 * @param date - The date to check (will extract month and year)
 * @returns Object with success status and message
 */
export const validateMonthNotLocked = async (
  siteId: string,
  date: Date,
): Promise<MonthValidationResult> => {
  try {
    if (!siteId) {
      return {
        success: false,
        message: "Site ID is required",
      };
    }

    if (!date || isNaN(date.getTime())) {
      return {
        success: false,
        message: "Valid date is required",
      };
    }

    const year = date.getFullYear();
    const month = date.getMonth() + 1; // JavaScript months are 0-indexed

    // Check if the month is closed for this site
    const monthClose = await prisma.monthClose.findFirst({
      where: {
        siteId: siteId,
        year: year,
        month: month,
        status: "LOCKED",
      },
    });

    if (monthClose) {
      return {
        success: false,
        message: `Cannot modify records for ${date.toLocaleString("default", { month: "long" })} ${year}. This month has been locked.`,
        data: {
          month: month,
          year: year,
          lockedAt: monthClose.lockedAt || undefined,
        },
      };
    }

    // Month is not locked
    return {
      success: true,
      message: `Month is open for ${date.toLocaleString("default", { month: "long" })} ${year}`,
      data: {
        month: month,
        year: year,
      },
    };
  } catch (error) {
    console.error("Error validating month:", error);
    return {
      success: false,
      message: "Error validating month lock status",
    };
  }
};

/**
 * Combined validation for both user and month
 * @param userId - The ID of the user to validate
 * @param siteId - The ID of the site
 * @param date - The date to check for month lock
 * @returns Object with success status and combined messages
 */
export const validateUserAndMonth = async (
  userId: string,
  siteId: string,
  date: Date,
): Promise<{
  success: boolean;
  userValidation: UserValidationResult;
  monthValidation: MonthValidationResult;
}> => {
  const userValidation = await validateUser(userId);

  if (!userValidation.success) {
    return {
      success: false,
      userValidation,
      monthValidation: { success: false, message: "Month validation skipped" },
    };
  }

  const monthValidation = await validateMonthNotLocked(siteId, date);

  return {
    success: monthValidation.success,
    userValidation,
    monthValidation,
  };
};
