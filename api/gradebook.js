// api/gradebook.js
export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    const { domain, username, password } = req. body || {};
    
    if (!domain || ! username || !password) {
      return res.status(400).json({ error: 'Missing domain, username, or password' });
    }
  
    try {
      // Direct SOAP call to StudentVUE
      const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns: xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <ProcessWebServiceRequest xmlns="http://edupoint.com/webservices/">
        <userID>${username}</userID>
        <password>${password}</password>
        <skipLoginLog>1</skipLoginLog>
        <parent>0</parent>
        <webServiceHandleName>PXPWebServices</webServiceHandleName>
        <methodName>Gradebook</methodName>
        <paramStr>&lt;Parms&gt;&lt;ChildIntID&gt;0&lt;/ChildIntID&gt;&lt;/Parms&gt;</paramStr>
      </ProcessWebServiceRequest>
    </soap: Body>
  </soap:Envelope>`;
  
      const response = await fetch(`${domain}/Service/PXPCommunication. asmx`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://edupoint.com/webservices/ProcessWebServiceRequest'
        },
        body: soapBody
      });
  
      const xmlText = await response.text();
      
      // Simple XML parsing (extract the Gradebook data)
      const resultMatch = xmlText.match(/<ProcessWebServiceRequestResult>([\s\S]*?)<\/ProcessWebServiceRequestResult>/);
      
      if (! resultMatch) {
        throw new Error('Invalid response from StudentVUE');
      }
  
      return res.status(200).json({ 
        success: true, 
        data: resultMatch[1] 
      });
  
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Login or fetch failed', details: err.message });
    }
  }