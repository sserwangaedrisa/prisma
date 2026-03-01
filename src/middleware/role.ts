import { type Request, type Response, type NextFunction } from "express";
import prisma from "../../prisma/config";

export const isAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: {
        role: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).send({ message: "User not found." });
    }

    if (user.role?.name === "admin") {
      next();
    } else {
      return res
        .status(403)
        .send({ message: "You're not permitted to access this resource" });
    }
  } catch (error: any) {
    console.log(error);
    res.status(500).send({ message: "Internal server error" });
  }
};

export const isCountryAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { countryId } = req.params;

  try {
    // Fetch the user based on the userId in the request
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: { id: true, role: true },
    });

    if (!user) {
      return res.status(404).send({ message: "User not found." });
    }

    // If the user is a global admin, allow them to proceed
    if (user.role?.name === "admin") {
      return next();
    }

    const userDetatails = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: { countryId: true },
    });
    const countryId = userDetatails?.countryId;
    // Fetch the country and its admins
    const country = await prisma.country.findUnique({
      where: { id: countryId! },
      include: { admins: true },
    });

    if (!country) {
      return res.status(404).json({ message: "Country not found" });
    }

    // Check if the user is a country admin for the specified country
    if (Array.isArray(country.admins) && req.user?.id) {
      const isCountryAdmin = country.admins.some(
        (admin) => admin.id === req.user?.id,
      );

      if (!isCountryAdmin) {
        return res
          .status(403)
          .json({ error: "Access denied. Not a country admin." });
      }

      // User is a country admin, allow them to proceed
      next();
    } else {
      return res.status(500).json({ error: "Internal server error" });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Internal server error" });
  }
};
