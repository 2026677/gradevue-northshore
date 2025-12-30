// api/gradebook.js
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req. method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { domain, username, password } = req. body || {};
  
  if (!domain || !username || !password) {
    return res.status(400).json({ error: 'Missing domain, username, or password' });
  }

  try {
    // Direct SOAP call to StudentVUE
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap: Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
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
    
    // Log the response for debugging
    console.log('StudentVUE Response:', xmlText. substring(0, 500));
    
    // Check for SOAP fault first
    if (xmlText.includes('soap:Fault') || xmlText.includes('faultstring')) {
      const faultMatch = xmlText.match(/<faultstring>(.*?)<\/faultstring>/);
      const faultMsg = faultMatch ? faultMatch[1] : 'Unknown SOAP error';
      throw new Error(`StudentVUE error: ${faultMsg}`);
    }
    
    // Try to extract the result
    const resultMatch = xmlText.match(/<ProcessWebServiceRequestResult>([\s\S]*? )<\/ProcessWebServiceRequestResult>/);
    
    if (!resultMatch) {
      // Return the actual response for debugging
      return res.status(500).json({ 
        error: 'Invalid response format', 
        details: 'Could not find ProcessWebServiceRequestResult',
        responsePreview: xmlText. substring(0, 1000)
      });
    }

    return res.status(200).json({ 
      success: true, 
      data:  resultMatch[1] 
    });

  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ 
      error: 'Login or fetch failed', 
      details:  err.message 
    });
  }
}