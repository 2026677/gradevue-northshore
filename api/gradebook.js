export default async function handler(req, res) {
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
    return res.status(400).json({ error: 'Missing credentials' });
  }

  try {
    const cleanDomain = domain.replace(/\/$/, '');
    
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

    const endpoint = `${cleanDomain}/Service/PXPCommunication. asmx`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction':  'http://edupoint.com/webservices/ProcessWebServiceRequest'
      },
      body: soapBody
    });

    const xmlText = await response.text();
    
    console.log('Response status:', response. status);
    console.log('Response length:', xmlText.length);
    
    if (xmlText.includes('soap:Fault') || xmlText.includes('faultstring')) {
      const faultMatch = xmlText.match(/<faultstring>(.*?)<\/faultstring>/);
      throw new Error(faultMatch ? faultMatch[1] : 'SOAP fault');
    }
    
    const resultMatch = xmlText.match(/<ProcessWebServiceRequestResult>([\s\S]*? )<\/ProcessWebServiceRequestResult>/);
    
    if (!resultMatch) {
      console.error('No result found.  Response preview:', xmlText.substring(0, 500));
      throw new Error('Invalid response structure');
    }

    const decodedData = resultMatch[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');

    return res.status(200).json({ 
      success: true, 
      data:  decodedData
    });

  } catch (err) {
    console.error('API Error:', err.message);
    return res.status(500).json({ 
      error: 'Login failed', 
      details: err. message 
    });
  }
}