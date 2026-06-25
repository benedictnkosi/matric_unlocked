import { NextResponse } from "next/server";
import { deleteQuestionById, getQuestionById } from "@/lib/questions";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const question = await getQuestionById(id);
    if (!question) {
      return NextResponse.json({ error: "Question not found." }, { status: 404 });
    }

    await deleteQuestionById(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete question.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
