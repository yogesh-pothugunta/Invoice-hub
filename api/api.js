import axios from 'axios';

const API = axios.create({
  baseURL: process.env.NODE_ENV === 'production'
    ? 'https://invoicehub-6hhp.onrender.com/api'
    : 'http://localhost:5000/api'
});

API.interceptors.request.use((config) => {
  const token = localStorage.getItem('ih_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

API.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('ih_token');
      localStorage.removeItem('ih_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authAPI = {
  register: (data) => API.post('/auth/register', data),
  login: (data) => API.post('/auth/login', data),
  verifyOTP: (data) => API.post('/auth/verify-otp', data),
  resendOTP: (data) => API.post('/auth/resend-otp', data),
  getMe: () => API.get('/auth/me'),
  updateProfile: (data) => API.put('/auth/profile', data),
  changePassword: (data) => API.put('/auth/change-password', data),
};

export const invoiceAPI = {
  getAll: (params) => API.get('/invoices', { params }),
  getOne: (id) => API.get(`/invoices/${id}`),
  create: (data) => API.post('/invoices', data),
  update: (id, data) => API.put(`/invoices/${id}`, data),
  delete: (id) => API.delete(`/invoices/${id}`),
  updateStatus: (id, data) => API.patch(`/invoices/${id}/status`, data),
  downloadPDF: (id) =>
    API.get(`/invoices/${id}/pdf`, { responseType: 'blob' }),
  sendEmail: (id, data) =>
    API.post(`/invoices/${id}/send-email`, data),
  exportCSV: (params) =>
    API.get('/invoices/export/csv', {
      params,
      responseType: 'blob',
    }),
};

export const clientAPI = {
  getAll: (params) => API.get('/clients', { params }),
  getOne: (id) => API.get(`/clients/${id}`),
  create: (data) => API.post('/clients', data),
  update: (id, data) => API.put(`/clients/${id}`, data),
  delete: (id) => API.delete(`/clients/${id}`),
};

export const dashboardAPI = {
  getStats: () => API.get('/dashboard/stats'),
  getRecent: () => API.get('/dashboard/recent'),
};

export const paymentAPI = {
  createOrder: (data) => API.post('/payments/create-order', data),
  verifyPayment: (data) => API.post('/payments/verify', data),
};

export default API;
