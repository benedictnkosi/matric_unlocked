import { NextResponse } from "next/server";
import { getQuestionById, updateQuestionReadyStatus } from "@/lib/questions";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { ready?: unknown };

    if (typeof body.ready !== "boolean") {
      return NextResponse.json({ error: "ready must be a boolean." }, { status: 400 });
    }

    const question = await getQuestionById(id);
    if (!question) {
      return NextResponse.json({ error: "Question not found." }, { status: 404 });
    }

    await updateQuestionReadyStatus(id, body.ready);

    return NextResponse.json({
      success: true,
      ready: body.ready,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update question ready status.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
