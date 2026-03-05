import { NextRequest, NextResponse } from "next/server";

const LINQ_BASE_URL = "https://api.linqapp.com/api/partner/v3";

// Manual endpoint to send a message (for testing)
export async function POST(request: NextRequest) {
  try {
    const { to, message } = await request.json();

    if (!to || !message) {
      return NextResponse.json(
        { error: "Missing 'to' and 'message' fields" },
        { status: 400 }
      );
    }

    const token = process.env.LINQ_API_TOKEN;
    const phoneNumber = process.env.LINQ_PHONE_NUMBER;

    if (!token || !phoneNumber) {
      return NextResponse.json(
        { error: "Missing LINQ_API_TOKEN or LINQ_PHONE_NUMBER env vars" },
        { status: 500 }
      );
    }

    const response = await fetch(`${LINQ_BASE_URL}/chats`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: phoneNumber,
        to: [to],
        message: {
          parts: [{ type: "text", value: message }],
        },
      }),
    });

    const responseText = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        { error: "Linq API error", status: response.status, details: responseText },
        { status: response.status }
      );
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      return NextResponse.json({ success: true, raw: responseText });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal error", message: String(error) },
      { status: 500 }
    );
  }
}
