const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const { requestRouter } = require('./routes/requestRouter.js');
const requestsRoutes = require('./routes/requests');
const { authRouter } = require('./routes/authRouter.js');
const { testRouter } = require('./routes/testRouter.js');
const { authenticate } = require('./middleware/authenticate.js');
const { errorHandler } = require('./middleware/errorHandler.js');

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRouter);
app.use('/api/bins', express.json(), authenticate, requestRouter);
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/test', express.json(), testRouter);
}
app.use('/', requestsRoutes);

app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(errorHandler);
module.exports = { app };
