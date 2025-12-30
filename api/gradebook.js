export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { domain, username, password } = req.body || {};
  if (!domain || !username || !password) {
    return res.status(400).json({ error: "Missing domain, username, or password" });
  }

  try {
    const cleanDomain = String(domain).replace(/\/+$/, "");

    // Correct SOAP body (no stray spaces in tags)
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ProcessWebServiceRequest xmlns="http://edupoint.com/webservices/">
      <userID>${username}</userID>
      <password>${password}</password>
      <skipLoginLog>1</skipLoginLog>
      <parent>0</parent>
      <webServiceHandleName>PXPWebServices</webServiceHandleName>
      <methodName>Gradebook</methodName>
      <paramStr>&lt;Parms&gt;&lt;ChildIntID&gt;0&lt;/ChildIntID&gt;&lt;ReportPeriod&gt;&lt;/ReportPeriod&gt;&lt;/Parms&gt;</paramStr>
    </ProcessWebServiceRequest>
  </soap:Body>
</soap:Envelope>`;

    const endpoints = [
      `${cleanDomain}/Service/PXPCommunication.asmx`,
      `${cleanDomain}/service/PXPCommunication.asmx`,
      `${cleanDomain}/PXPCommunication.asmx`,
    ];

    const headers = {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": "http://edupoint.com/webservices/ProcessWebServiceRequest",
      "Accept": "text/xml",
      "User-Agent": "GradeVue/1.0 (+https://vercel.com)",
    };

    let xmlText = "";
    let hitEndpoint = "";
    let lastStatus = 0;

    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep, { method: "POST", headers, body: soapBody });
        lastStatus = resp.status;
        const text = await resp.text();

        // If we get any XML with the ProcessWebServiceRequestResult, use it
        if (resp.ok && /<ProcessWebServiceRequestResult>[\s\S]*<\/ProcessWebServiceRequestResult>/.test(text)) {
          xmlText = text;
          hitEndpoint = ep;
          break;
        }

        // If resp.ok but no result, keep trying the next endpoint
        if (resp.ok) {
          xmlText = text;
          hitEndpoint = ep;
          // continue to try other endpoints; maybe case differs
        }
      } catch (e) {
        // try next endpoint
      }
    }

    if (!xmlText) {
      console.error("No XML text received from any endpoint", { lastStatus, endpointsTried: endpoints });
      return res.status(500).json({
        error: "Login failed",
        details: `No XML response. HTTP status: ${lastStatus}. Check domain and credentials.`,
      });
    }

    // Handle SOAP faults
    if (xmlText.includes("soap:Fault") || xmlText.includes("<faultstring>")) {
      const faultMsg = (xmlText.match(/<faultstring>(.*?)<\/faultstring>/) || [,"Unknown SOAP error"])[1];
      console.error("SOAP Fault", { faultMsg, hitEndpoint });
      return res.status(500).json({ error: "Login failed", details: `StudentVUE error: ${faultMsg}` });
    }

    // Extract the inner XML string returned by ProcessWebServiceRequestResult
    const match = xmlText.match(/<ProcessWebServiceRequestResult>([\s\S]*?)<\/ProcessWebServiceRequestResult>/);
    if (!match) {
      console.error("Invalid SOAP response structure", { hitEndpoint, preview: xmlText.slice(0, 500) });
      return res.status(500).json({ error: "Login failed", details: "Invalid SOAP response structure" });
    }

    // Decode HTML entities to get raw XML
    const decoded = match[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");

    // Basic sanity check: it should look like real XML now
    if (!/^<\?xml[\s\S]*<GradeBook/m.test(decoded) && !decoded.includes("<Gradebook")) {
      console.warn("Decoded content does not look like Gradebook XML", { preview: decoded.slice(0, 500) });
    }

    // Success
    console.log("Gradebook fetched", { endpoint: hitEndpoint, length: decoded.length });
    return res.status(200).json({ success: true, data: decoded });
  } catch (err) {
    console.error("Backend error", err);
    return res.status(500).json({ error: "Login failed", details: err.message || "Unknown error" });
  }
}