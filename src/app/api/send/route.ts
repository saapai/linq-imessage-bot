import { NextRequest, NextResponse } from "next/server";

const LINQ_BASE_URL = "https://api.linqapp.com/api/partner/v3";

export async function POST(request: NextRequest) {
  // Step 1: Parse request
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json({ error: "Failed to parse request", detail: String(e) }, { status: 400 });
  }

  const { to, message } = body;
  if (!to || !message) {
    return NextResponse.json({ error: "Missing 'to' and 'message'" }, { status: 400 });
  }

  const token = process.env.LINQ_API_TOKEN;
  const phoneNumber = process.env.LINQ_PHONE_NUMBER;
  if (!token || !phoneNumber) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  // Step 2: Call Linq API
  let response;
  try {
    response = await fetch(`${LINQ_BASE_URL}/chats`, {
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
  } catch (e) {
    return NextResponse.json({ error: "Fetch failed", detail: String(e) }, { status: 500 });
  }

  // Step 3: Read response
  let responseText;
  try {
    responseText = await response.text();
  } catch (e) {
    return NextResponse.json({ error: "Failed to read response", detail: String(e) }, { status: 500 });
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: "Linq error", status: response.status, body: responseText },
      { status: response.status }
    );
  }

  // Step 4: Parse response
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    return NextResponse.json({ success: true, rawResponse: responseText.substring(0, 500) });
  }

  return NextResponse.json({ success: true, data });
}
