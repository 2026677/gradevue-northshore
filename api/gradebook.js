export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { domain, username, password, reportPeriod = "", childIntID = "0" } = req.body || {};
  if (!domain || !username || !password) {
    return res.status(400).json({ error: "Missing domain, username, or password" });
  }

  try {
    const cleanDomain = String(domain).replace(/\/+$/, "");

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
      <paramStr>&lt;Parms&gt;&lt;ChildIntID&gt;${childIntID}&lt;/ChildIntID&gt;&lt;ReportPeriod&gt;${reportPeriod}&lt;/ReportPeriod&gt;&lt;/Parms&gt;</paramStr>
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
    let lastStatus = 0;

    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep, { method: "POST", headers, body: soapBody });
        lastStatus = resp.status;
        const text = await resp.text();
        if (resp.ok) {
          xmlText = text;
          break;
        }
      } catch {
        // try next
      }
    }

    if (!xmlText) {
      return res.status(500).json({
        error: "Login failed",
        details: `No XML response. HTTP status: ${lastStatus}. Check domain and credentials.`,
      });
    }

    if (xmlText.includes("soap:Fault") || xmlText.includes("<faultstring>")) {
      const faultMsg = (xmlText.match(/<faultstring>(.*?)<\/faultstring>/) || [,"Unknown SOAP error"])[1];
      return res.status(500).json({ error: "Login failed", details: `StudentVUE error: ${faultMsg}` });
    }

    const match = xmlText.match(/<ProcessWebServiceRequestResult>([\s\S]*?)<\/ProcessWebServiceRequestResult>/);
    if (!match) {
      return res.status(500).json({ error: "Login failed", details: "Invalid SOAP response structure" });
    }

    const decoded = match[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");

    return res.status(200).json({ success: true, data: decoded });
  } catch (err) {
    return res.status(500).json({ error: "Login failed", details: err.message || "Unknown error" });
  }
}
