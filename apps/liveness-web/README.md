# @lucky/liveness-web — KYC Liveness Detection

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](apps/liveness-web/package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite)
[![AWS Amplify](https://img.shields.io/badge/AWS_Amplify-6-FF9900?logo=awsamplify)

> Face liveness verification web application built with AWS Rekognition and Amplify. Part of the [Lucky Nest Monorepo](../README.md).

---

## ✨ Overview

`@lucky/liveness-web` is a standalone web application that performs **face liveness detection** for KYC (Know Your Customer) verification. It uses **AWS Rekognition** via the **Amplify UI React Liveness** component to verify that a real person (not a photo, video, or mask) is present during identity verification.

The app is deployed on **Cloudflare Workers** and is accessed as an embedded webview or standalone page during the KYC flow.

---

## 🛠️ Tech Stack

| Category       | Technologies                                                         |
| -------------- | -------------------------------------------------------------------- |
| **Framework**  | React 19, TypeScript 5.9                                             |
| **Build**      | Vite 5                                                               |
| **Liveness**   | AWS Amplify (UI React Liveness), AWS Rekognition                     |
| **Cloud**      | AWS (Cognito, Rekognition), Cloudflare Workers (deployment)          |
| **Linting**    | ESLint 9, typescript-eslint, eslint-plugin-react-hooks               |

---

## How It Works

1. User initiates KYC verification in the main app or admin panel
2. User is redirected to the liveness web app (embedded or standalone)
3. The app uses the device camera to capture a short video of the user's face
4. AWS Rekognition analyzes the video for liveness indicators (eye movement, depth, texture)
5. A liveness score is returned to the backend API
6. The KYC record is updated with the verification result

---

## 🚀 Getting Started

### Development

```bash
# Start dev server (port 5173 by default)
yarn workspace @lucky/liveness-web dev
```

### Build

```bash
yarn workspace @lucky/liveness-web build
```

---

## 🔧 Environment Variables

| Variable                    | Description                            |
| --------------------------- | -------------------------------------- |
| `VITE_AWS_REGION`           | AWS region for Rekognition             |
| `VITE_COGNITO_IDENTITY_POOL`| Cognito Identity Pool ID               |
| `VITE_LIVENESS_API_URL`     | Backend API URL for liveness results   |

---

## 🔗 Related

- [Monorepo Root](../README.md) — Project overview and architecture
- [@lucky/api](../api/README.md) — NestJS backend API (KYC endpoints)
- [@lucky/admin-next](../admin-next/README.md) — Admin dashboard (KYC review)

---

## 📄 License

Part of the Lucky Nest Monorepo. See the [root license](../README.md) for details.
