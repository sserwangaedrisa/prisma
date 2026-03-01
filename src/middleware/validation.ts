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

export const userprofilePolicy = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const schema = Joi.object({
    fullName: Joi.string().min(3).max(255),
    password: Joi.string().min(3).max(255),
    status: Joi.number().integer(),
  });
  const { fullName, password, status } = req.body;
  const { error } = schema.validate({ fullName, password, status });
  if (error) {
    return res.status(500).send({
      message: error.details[0]?.message,
    });
  }
  return next();
};
// users end

// donation start
export const getPaymentUrlPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const schema = Joi.object({
    fullName: Joi.string().min(3).max(255).required(),
    email: Joi.string().email({ minDomainSegments: 2 }).required(),
    currency: Joi.string().required(),
    amount: Joi.number().integer().required(),
    donationType: Joi.string().required(),
    donationTitle: Joi.string().required(),
  });
  const { fullName, email, currency, amount, donationType, donationTitle } =
    req.body;
  const { error } = schema.validate({
    fullName,
    email,
    currency,
    amount,
    donationType,
    donationTitle,
  });
  if (error) {
    return res.status(500).send({
      message: error.details[0]?.message,
    });
  }
  return next();
};

export const getPaymentUrlPolicys = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const schema = Joi.object({
      fullName: Joi.string().min(3).max(255).required(),
      email: Joi.string().email({ minDomainSegments: 2 }).required(),
      currency: Joi.string().required(),
      amount: Joi.number().integer().min(1).required(),
      donationType: Joi.string().min(3).required(),
      donationTitle: Joi.string().min(3).required(),
    });

    const { fullName, email, currency, amount, donationType, donationTitle } =
      req.body;

    // Validate the input
    const { error } = schema.validate({
      fullName,
      email,
      currency,
      amount,
      donationType,
      donationTitle,
    });

    if (error) {
      return res.status(400).send({
        message: error.details[0]?.message,
      });
    }

    // Validate that the currency exists in the wallet database
    const wallet = await prisma.wallet.findFirst({
      where: {
        currency: currency,
        status: 1,
      },
      select: { id: true },
    });

    if (!wallet) {
      return res.status(400).send({
        message: `Unsupported or inactive currency: ${currency}`,
      });
    }

    return next();
  } catch (err) {
    return res.status(500).send({
      message: "Error validating input data.",
    });
  }
};
// donation end

// contact form start
export const contactFormPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const schema = Joi.object({
    name: Joi.string().min(3).max(255).required(),
    email: Joi.string().email({ minDomainSegments: 2 }).required(),
    subject: Joi.string().required(),
    message: Joi.string().required(),
  });
  const { name, email, subject, message } = req.body;
  const { error } = schema.validate({ name, email, subject, message });
  if (error) {
    return res.status(500).send({
      message: error.details[0]?.message,
    });
  }
  return next();
};

export const careersFormPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const schema = Joi.object({
    name: Joi.string().min(3).max(255).required(),
    email: Joi.string().email({ minDomainSegments: 2 }).required(),
    phone: Joi.string().required(),
    country: Joi.string().required(),
    message: Joi.string().required(),
    role: Joi.string().required(),
  });
  const { name, email, phone, country, message, role } = req.body;
  const { error } = schema.validate({
    name,
    email,
    phone,
    country,
    message,
    role,
  });
  if (error) {
    return res.status(500).send({
      message: error.details[0]?.message,
    });
  }
  return next();
};

export const patchcareersFormPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const schema = Joi.object({
    name: Joi.string().min(3).max(255),
    email: Joi.string().email({ minDomainSegments: 2 }),
    phone: Joi.string(),
    country: Joi.string(),
    message: Joi.string(),
    role: Joi.string(),
    status: Joi.number().integer(),
  });
  const { name, email, phone, country, message, role, status } = req.body;
  const { error } = schema.validate({
    name,
    email,
    phone,
    country,
    message,
    role,
    status,
  });
  if (error) {
    return res.status(500).send({
      message: error.details[0]?.message,
    });
  }
  return next();
};

export const petitionFormPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const schema = Joi.object({
    country: Joi.string().required(),
    email: Joi.string().email({ minDomainSegments: 2 }).required(),
    message: Joi.string().required(),
    phone: Joi.string().required(),
    names: Joi.string().required(),
  });
  const { country, email, message, phone, names } = req.body;
  const { error } = schema.validate({ country, email, message, phone, names });
  if (error) {
    return res.status(500).send({
      message: error.details[0]?.message,
    });
  }
  return next();
};
// contact form end
