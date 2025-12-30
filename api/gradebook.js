export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    domain,
    username,
    password,
    reportPeriod = "",
    childIntID: childIntFromClient = ""
  } = req.body || {};
  if (!domain || !username || !password) {
    return res.status(400).json({ error: "Missing domain, username, or password" });
  }

  try {
    const cleanDomain = String(domain).replace(/\/+$/, "");
    const endpoints = [
      `${cleanDomain}/Service/PXPCommunication.asmx`,
      `${cleanDomain}/service/PXPCommunication.asmx`,
      `${cleanDomain}/PXPCommunication.asmx`,
    ];
    const headers = {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": "http://edupoint.com/webservices/ProcessWebServiceRequest",
      "Accept": "text/xml",
      "User-Agent": "GradeVue/1.0",
    };

    const soapEnvelope = (inner) => `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    ${inner}
  </soap:Body>
</soap:Envelope>`;

    const pxpBody = (methodName, paramStrXml) => `
<ProcessWebServiceRequest xmlns="http://edupoint.com/webservices/">
  <userID>${username}</userID>
  <password>${password}</password>
  <skipLoginLog>1</skipLoginLog>
  <parent>0</parent>
  <webServiceHandleName>PXPWebServices</webServiceHandleName>
  <methodName>${methodName}</methodName>
  <paramStr>${paramStrXml}</paramStr>
</ProcessWebServiceRequest>`.trim();

    async function pxpCall(methodName, paramObj) {
      const paramStrXml = escapeXml(buildParms(paramObj));
      const body = soapEnvelope(pxpBody(methodName, paramStrXml));
      let text = "";
      let status = 0;

      for (const ep of endpoints) {
        try {
          const resp = await fetch(ep, { method: "POST", headers, body });
          status = resp.status;
          const t = await resp.text();
          if (resp.ok) {
            text = t;
            break;
          }
        } catch {
          // try next endpoint
        }
      }
      if (!text) throw new Error(`No SOAP response (status ${status})`);

      if (text.includes("soap:Fault") || text.includes("<faultstring>")) {
        const faultMsg = (text.match(/<faultstring>(.*?)<\/faultstring>/) || [,"Unknown SOAP error"])[1];
        throw new Error(`StudentVUE error: ${faultMsg}`);
      }

      const match = text.match(/<ProcessWebServiceRequestResult>([\s\S]*?)<\/ProcessWebServiceRequestResult>/);
      if (!match) throw new Error("Invalid SOAP response structure");

      const decoded = decodeXmlEntities(match[1]);
      return decoded;
    }

    function buildParms(obj) {
      const entries = Object.entries(obj || {});
      const inner = entries.map(([k, v]) => `<${k}>${v ?? ""}</${k}>`).join("");
      return `<Parms>${inner}</Parms>`;
    }
    function escapeXml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    }
    function decodeXmlEntities(s) {
      return String(s)
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
    }

    // 1) StudentInfo for accurate name + ChildIntID (fallbacks below)
    let studentName = "";
    let studentId = "";
    let childIntID = childIntFromClient || "0";

    try {
      const studentInfoXml = await pxpCall("StudentInfo", { ChildIntID: childIntID || "0" });
      studentName =
        (studentInfoXml.match(/StudentInfo[^>]*StudentName="([^"]*)"/)?.[1]) ||
        (studentInfoXml.match(/Student[^>]*Name="([^"]*)"/)?.[1]) ||
        "";
      studentId =
        (studentInfoXml.match(/StudentInfo[^>]*StudentNumber="([^"]*)"/)?.[1]) ||
        (studentInfoXml.match(/Student[^>]*StudentNumber="([^"]*)"/)?.[1]) ||
        "";
      const childAttr =
        (studentInfoXml.match(/ChildIntID[^>]*>(\d+)</)?.[1]) ||
        (studentInfoXml.match(/ChildIntID="(\d+)"/)?.[1]) ||
        "";
      if (childAttr) childIntID = childAttr;
    } catch {
      // continue; we'll fill from Gradebook if possible
    }

    // 2) Gradebook for the selected/default report period
    const gradebookXml = await pxpCall("Gradebook", {
      ChildIntID: childIntID || "0",
      ReportPeriod: reportPeriod || "",
    });

    // Fallback: get StudentInfo from Gradebook block if present
    if (!studentName || !studentId) {
      const siMatch = gradebookXml.match(/<StudentInfo\b[^>]*>/);
      if (siMatch) {
        studentName =
          (siMatch[0].match(/\bStudentName="([^"]*)"/)?.[1]) || studentName;
        studentId =
          (siMatch[0].match(/\bStudentNumber="([^"]*)"/)?.[1]) || studentId;
      }
    }
    if (!studentId) studentId = username; // final fallback
    if (!studentName) studentName = username ? `Student ${username}` : "Student";

    // 3) Extract reporting periods + active
    const periods = [];
    gradebookXml.replace(/<ReportPeriod\b([^>]*)>/g, (_, attrs) => {
      const name =
        (attrs.match(/\bName="([^"]*)"/)?.[1]) ||
        (attrs.match(/\bDescr="([^"]*)"/)?.[1]) ||
        (attrs.match(/\bAbbrv="([^"]*)"/)?.[1]) ||
        "";
      const selected =
        (attrs.match(/\bSelected="([^"]*)"/)?.[1]) ||
        (attrs.match(/\bIsCurrent="([^"]*)"/)?.[1]) ||
        "";
      if (name) periods.push({ name, active: /^(true|1)$/i.test(selected) });
      return _;
    });
    if (periods.length === 0) {
      // Fallback from marks
      gradebookXml.replace(/<Mark\b([^>]*)>/g, (_, attrs) => {
        const name =
          (attrs.match(/\bMarkName="([^"]*)"/)?.[1]) ||
          (attrs.match(/\bMarkCalc="([^"]*)"/)?.[1]) ||
          "";
        const current =
          (attrs.match(/\bIsCurrent="([^"]*)"/)?.[1]) ||
          (attrs.match(/\bIsCurrentReportingPeriod="([^"]*)"/)?.[1]) ||
          "";
        if (name) periods.push({ name, active: /^(true|1)$/i.test(current) });
        return _;
      });
    }
    // Deduplicate by name
    const seen = new Set();
    const uniquePeriods = periods.filter(p => {
      if (seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    });
    // If none marked active, default first
    if (!uniquePeriods.some(p => p.active) && uniquePeriods.length) {
      uniquePeriods[0].active = true;
    }

    return res.status(200).json({
      success: true,
      data: gradebookXml,
      student: { name: studentName, id: studentId, childIntID },
      periods: uniquePeriods,
    });
  } catch (err) {
    return res.status(500).json({ error: "Login failed", details: err.message || "Unknown error" });
  }
}
