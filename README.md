# Attendance & Payroll Management API Server

## Overview

The **Attendance & Payroll Management API Server** [Live API Server](https://prisma-gold-chi.vercel.app/) is the backend service powering the Attendance & Payroll Management Web Application.

This server provides secure REST API endpoints responsible for:

* User authentication and authorization
* Attendance management
* Worker records management
* Payroll processing
* Payment approval workflows
* Company operation reports
* Data persistence and business logic

The API is designed to replace manual workforce management processes by providing a secure, scalable, and transparent digital solution for companies.

This project is an **open-source project** and welcomes developers who are interested in contributing, improving features, fixing bugs, and collaborating towards building a professional workforce management platform.

---

# Related Project

## Frontend Application

The frontend of this project is built with:

* React
* TypeScript
* Vite
* Tailwind CSS

It provides:

* Company landing page
* Laborer dashboard
* Foreman dashboard
* Owner/Admin dashboard
* Role-based user experience

Frontend Repository:

[Frontend repo] (https://github.com/sserwangaedrisa/labor_App_API)


Live Application:

[Live Frontend Application](INSERT_FRONTEND_URL_HERE)


---

# Problem Statement

Many companies still depend on manual attendance registers and payroll calculations which can lead to:

* Incorrect attendance records
* Payroll calculation mistakes
* Low professionalism
* Poor workforce transparency
* Increased chances of record manipulation

This API solves these challenges by providing automated attendance management and payroll processing workflows.

---

# Main Features

## 1. Authentication & Authorization

The API implements secure user management using:

* JWT authentication
* Cookie-based session handling
* Role-Based Access Control (RBAC)
* Protected API routes

Supported user roles:

* Laborer
* Foreman
* Owner/Admin

Each role has controlled access to specific resources and operations.

---

# 2. Attendance Management

The attendance module provides complete attendance record management.

## Features

* Create attendance records
* Update attendance information
* View attendance history
* Manage worker attendance
* Track work entries
* Maintain accurate workforce records

## Purpose

The attendance system eliminates manual attendance books and provides a reliable digital record system.

---

# 3. Payment Management

The payment module manages worker payroll operations.

## Features

* Create payment requests
* Review payment requests
* Approve payments
* Reject payments
* Mark payments as paid
* Update payment information
* Delete payment requests

## Payment Workflow

```
Laborer Work Entry
        |
        ↓
Foreman Review
        |
        ↓
Payment Request
        |
        ↓
Owner/Admin Approval
        |
        ↓
Payment Completed
```

---

# 4. Reports Management

The reporting module provides operational insights for company management.

## Features

* Attendance reports
* Worker activity reports
* Payment reports
* Company operation summaries
* Workforce performance tracking

Reports help company owners make better management decisions using accurate data.

---

# Technology Stack

## Backend

* Node.js
* TypeScript
* Express.js

## Database

* PostgreSQL

## ORM

* Prisma ORM

## Authentication

* JSON Web Tokens (JWT)
* Cookies

## Development Tools

* Git
* GitHub
* npm

---




# Installation Guide

## Clone Repository

```bash
git clone https://github.com/sserwangaedrisa/prisma.git
```
[Backend Repository](https://github.com/sserwangaedrisa/prisma)
---

## Navigate Into Project

```bash
cd attendance-payroll-server
```

---

## Install Dependencies

```bash
npm install
```

---

# Environment Setup

Create a `.env` file: "email the author for the .env details '


# Database Setup

Generate Prisma Client:

```bash
npx prisma generate
```

Run database migrations:

```bash
npx prisma migrate dev
```

---

# Running the Server

Development mode:

```bash
npm run dev
```



---

# Project Structure

```
src/
|
├── controllers/
├── routes/
├── middleware/
├── services/
├── prisma/
├── utils/
├── types/
├── config/
└── app.ts
```

---

# Contributing

Contributions are highly welcome.

This project is open-source and developers are encouraged to collaborate.

---

# How To Contribute

## 1. Fork The Repository

Click the **Fork** button on GitHub.

---

## 2. Clone Your Fork

```bash
git clone https://github.com/sserwangaedrisa/prisma.git
```


---

## 3. Create A Development Branch

```bash
git checkout -b feature/new-feature
```

---

## 4. Make Changes

Examples:

* Add new API endpoints
* Improve authentication
* Optimize database queries
* Fix bugs
* Improve documentation

---

## 5. Commit Changes

```bash
git commit -m "Add new feature"
```

---

## 6. Push Changes

```bash
git push origin feature/new-feature
```

---

## 7. Submit Pull Request

Open a Pull Request explaining:

* The problem solved
* Changes made
* Testing performed
* Screenshots if needed

---

# Future Improvements

* Mobile application API support
* Advanced analytics
* Automated payroll generation
* PDF reports
* Biometric attendance integration
* Multi-company support
* SMS notifications
* AI-powered workforce insights

---

# License

This project is licensed under the MIT License.

---
# Author

**Sserwanga Edirisa**

GitHub:

[https://github.com/sserwangaedrisa](https://github.com/sserwangaedrisa)

Email:

[sserwangaedrisa@gmail.com](mailto:sserwangaedrisa@gmail.com)

LinkedIn:

[Sserwanga Edirisa LinkedIn](https://www.linkedin.com/in/sserwanga-edirisa-808201197/)

---

# Support The Project

If you find this project useful:

⭐ Star the repository

🍴 Fork the project

🤝 Contribute improvements

Together we can build a better workforce management system.
