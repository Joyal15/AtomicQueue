import express from 'express';
const app = express();
const port = Number(process.env.PORT || 4000);
app.use(express.json());
app.get('/health', (_req, res) => {
    const sampleUser = {
        id: 'user_123',
        role: 'owner',
    };
    res.json({
        status: 'ok',
        message: 'API is running',
        user: sampleUser,
    });
});
app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
});
