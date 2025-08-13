const request = require('supertest');
require('dotenv').config();

// Force test env and local test DB
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/carbon_net_zero_test';

const app = require('../server');

describe('API smoke tests', () => {
  it('GET / should return health text', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/Carbon Net-Zero API/);
  });

  it('GET /api should return base info', async () => {
    const res = await request(app).get((process.env.API_BASE || '/api'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });
  afterAll(async () => {
    const mongoose = require('mongoose');
    await mongoose.connection.close();
  });
});
