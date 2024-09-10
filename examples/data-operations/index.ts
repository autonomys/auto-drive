import axios from 'axios';
import fs from 'fs/promises'; // Added import for fs

const API_URL = 'http://localhost:3000';

const submitData = (data: string | Buffer, filename?: string, mimeType?: string) =>
    axios.post(`${API_URL}/upload-file`, {
        data: Buffer.isBuffer(data) ? data.toString('base64') : Buffer.from(data).toString('base64'),
        filename,
        mimeType,
    });

const retrieveData = (metadataCid: string) =>
    axios.get(`${API_URL}/retrieve/${metadataCid}`, { responseType: 'arraybuffer' });

const logResult =
    (message: string) =>
    (result: unknown): void =>
        console.log(message, JSON.stringify(result, null, 2));

const handleError = (error: Error): void => console.error(error.message);

const generateLargeData = (size: number): string => {
    const chunk = 'A'.repeat(1024); // 1KB chunk
    return chunk.repeat(size);
};

const submitAndRetrieve = async (data: string | Buffer, filename?: string, mimeType?: string) => {
    const submitResponse = await submitData(data, filename, mimeType);
    logResult('Submitted data. transactionResults:')(submitResponse.data.result.transactionResults);

    const retrieveResponse = await retrieveData(submitResponse.data.result.cid);
    const retrievedData = Buffer.from(retrieveResponse.data, 'base64');

    // Compare the original data with the retrieved data
    const originalData = Buffer.isBuffer(data) ? data : Buffer.from(data);
    console.log('Original data size:', originalData.length);
    console.log('Retrieved data size:', retrievedData.length);
    console.log('Data integrity check:', originalData.equals(retrievedData) ? 'Passed' : 'Failed');
};

const main = async () => {
    const smallData = 'This is a small piece of data';
    const largeData = generateLargeData(256); // 256KB of data

    console.log('Submitting and retrieving small data:');
    await submitAndRetrieve(smallData);

    console.log('\nSubmitting and retrieving large data:');
    await submitAndRetrieve(largeData, 'large_file.txt', 'text/plain');

    console.log('\nSubmitting and retrieving PDF file:');
    const pdfData = await fs.readFile('autonomys_whitepaper.pdf').catch(error => {
        console.error('Error reading PDF:', error);
        throw error; // Rethrow to handle it in the main function
    });
    await submitAndRetrieve(pdfData, 'autonomys_whitepaper.pdf', 'application/pdf');
};

main().catch(handleError);
