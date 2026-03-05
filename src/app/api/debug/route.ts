import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const raw = await request.text();
  return NextResponse.json({
    rawLength: raw.length,
    raw: raw,
    envCheck: {
      hasLinqToken: !!process.env.LINQ_API_TOKEN,
      linqTokenLength: process.env.LINQ_API_TOKEN?.length,
      phoneNumber: process.env.LINQ_PHONE_NUMBER,
      hasOpenAI: !!process.env.OPENAI_API_KEY,
    },
  });
}

export async function GET() {
  return NextResponse.json({
    envCheck: {
      hasLinqToken: !!process.env.LINQ_API_TOKEN,
      linqTokenLength: process.env.LINQ_API_TOKEN?.length,
      phoneNumber: process.env.LINQ_PHONE_NUMBER,
      hasOpenAI: !!process.env.OPENAI_API_KEY,
    },
  });
}
