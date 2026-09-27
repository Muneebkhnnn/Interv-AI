"use server";

import { currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";

export const getIntervieweeAppointments = async () => {
  const user = await currentUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  const dbUser = await db.user.findUnique({
    where: { clerkUserId: user.id },
    select: {
      id: true,
      role: true,
    },
  });

  if (!dbUser) {
    throw new Error("User not found");
  }

  if (dbUser.role !== "INTERVIEWEE") {
    throw new Error("Forbidden");
  }

  return db.booking.findMany({
    where: { intervieweeId: dbUser.id },
    include: {
      interviewer: {
        select: {
          name: true,
          imageUrl: true,
          email: true,
          title: true,
          company: true,
          categories: true,
        },
      },
      feedback: true,
    },
    orderBy: { startTime: "desc" },
  });
};