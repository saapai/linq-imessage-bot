import { NextRequest, NextResponse } from "next/server";

const LINQ_API_TOKEN = process.env.LINQ_API_TOKEN!;
const LINQ_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const LINQ_PHONE_NUMBER = process.env.LINQ_PHONE_NUMBER!;

// Manual endpoint to send a message (for testing)
export async function POST(request: NextRequest) {
  const { to, message } = await request.json();

  if (!to || !message) {
    return NextResponse.json(
      { error: "Missing 'to' and 'message' fields" },
      { status: 400 }
    );
  }

  // Create a chat and send message
  const response = await fetch(`${LINQ_BASE_URL}/chats`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LINQ_API_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      from: LINQ_PHONE_NUMBER,
      to: [to],
      message: {
        parts: [{ type: "text", value: message }],
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      { error: "Linq API error", details: errorText },
      { status: response.status }
    );
  }

  const data = await response.json();
  return NextResponse.json({ success: true, data });
}
