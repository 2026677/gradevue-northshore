export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req. method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { domain, username, password } = req. body || {};
  
  if (!domain || ! username || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  try {
    const cleanDomain = domain.replace(/\/$/, '');
    
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap: Body>
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

    const endpoint = `${cleanDomain}/Service/PXPCommunication.asmx`;
    
    console.log('=== CALLING ENDPOINT ===');
    console.log(endpoint);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://edupoint.com/webservices/ProcessWebServiceRequest'
      },
      body:  soapBody
    });

    const xmlText = await response.text();
    
    console.log('=== RESPONSE STATUS ===');
    console.log(response.status);
    console.log('=== RESPONSE (first 1000 chars) ===');
    console.log(xmlText. substring(0, 1000));
    
    // Return everything for debugging
    return res.status(200).json({ 
      debug: true,
      endpoint:  endpoint,
      status: response.status,
      responsePreview: xmlText.substring(0, 2000),
      data: xmlText
    });

  } catch (err) {
    console.error('=== ERROR ===');
    console.error(err. message);
    return res.status(500).json({ 
      error: 'Request failed', 
      details: err.message 
    });
  }
}