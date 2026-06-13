const PAGE_GRAPHQL_FETCH = `
async function __browserListenerPageGraphqlFetch(url, fields) {
  const fb_dtsg =
    document.querySelector('input[name="fb_dtsg"]')?.getAttribute("value") || "";
  const lsd = document.querySelector('input[name="lsd"]')?.getAttribute("value") || "";
  const user = (document.cookie.match(/(?:^|;\\s*)c_user=(\\d+)/) || [])[1] || "";
  if (fb_dtsg) fields.fb_dtsg = fb_dtsg;
  if (lsd) fields.lsd = lsd;
  if (user) {
    fields.__user = user;
    fields.av = user;
  }
  const body = new URLSearchParams(fields).toString();
  const friendlyName = fields.fb_api_req_friendly_name || "";
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(friendlyName ? { "X-FB-Friendly-Name": friendlyName } : {}),
    },
    body,
  });
  return { status: res.status, ok: res.ok, body: await res.text() };
}
`;

export interface PageFetchResult {
  ok: boolean;
  status: number;
  body: string;
  error?: string;
}

export async function fetchGraphqlInPage(
  tabId: number,
  fields: Record<string, string>,
): Promise<PageFetchResult> {
  const url = "https://www.facebook.com/api/graphql/";
  const expression = `(async () => {
    ${PAGE_GRAPHQL_FETCH}
    return await __browserListenerPageGraphqlFetch(${JSON.stringify(url)}, ${JSON.stringify(fields)});
  })()`;

  try {
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    const raw = (await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as {
      exceptionDetails?: { text?: string; exception?: { description?: string } };
      result?: { value?: PageFetchResult };
    };

    if (raw.exceptionDetails) {
      const msg =
        raw.exceptionDetails.exception?.description ??
        raw.exceptionDetails.text ??
        "Runtime.evaluate failed";
      return { ok: false, status: 0, body: "", error: msg };
    }

    const value = raw.result?.value;
    if (!value || typeof value !== "object") {
      return { ok: false, status: 0, body: "", error: "empty evaluate result" };
    }
    return value as PageFetchResult;
  } catch (err) {
    return { ok: false, status: 0, body: "", error: (err as Error).message };
  }
}
