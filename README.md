# ምኞት Backend

Express REST API backed by PostgreSQL/Prisma, secured with JWT, with Socket.IO realtime queue updates.

## Setup

1. Start PostgreSQL. From the repository root, `docker compose up -d` is the quickest option.
2. Copy `.env.example` to `.env` and replace `JWT_SECRET` outside local development.
3. Run:

```powershell
npm install
npm run db:deploy
npm run db:seed
npm run dev
```

The API is available at `http://localhost:8000`; health check: `GET /health`.

## Docker deployment

Build the backend image from this directory:

```powershell
docker build -t callerq-backend .
```

Run it with the production database URL and a strong JWT secret:

```powershell
docker run -d --name callerq-backend --restart unless-stopped -p 8000:8000 `
  -e DATABASE_URL="postgresql://USER:PASSWORD@DATABASE_HOST:5432/callerq?schema=public" `
  -e JWT_SECRET="REPLACE_WITH_A_LONG_RANDOM_SECRET" `
  -e CLIENT_URL="*" `
  callerq-backend
```

The container applies pending Prisma migrations before starting the API. Do not
put production secrets in the image or commit them to `.env`; provide them through
your server/container platform. After deployment, verify `https://api.example.com/health`.

Useful commands:

```powershell
npm run prisma:generate
npm run db:migrate
npm run db:seed
npm test
```

Demo owner: `0911000000` / `password123`.

## Environment

| Variable | Purpose | Example |
|---|---|---|
| `PGHOST` | PostgreSQL host | `localhost` |
| `PGPORT` | PostgreSQL port | `5432` |
| `PGDATABASE` | PostgreSQL database | `callerq` |
| `PGUSER` | PostgreSQL user | `postgres` |
| `PGPASSWORD` | PostgreSQL password | local password |
| `JWT_SECRET` | JWT signing secret | long random value |
| `JWT_EXPIRES_IN` | Token lifetime | `7d` |
| `HOST` | Network interface to listen on | `0.0.0.0` |
| `PORT` | HTTP/Socket.IO port | `8000` |
| `CLIENT_URL` | Allowed CORS origin(s), comma-separated | `*` |
| `NODE_ENV` | Runtime mode | `development` |

Protected routes require `Authorization: Bearer <token>`. All business-owned records are filtered by the authenticated owner's business ID.

## Response format

```json
{ "success": true, "message": "Success message", "data": {} }
```

```json
{ "success": false, "message": "Error message", "errors": [] }
```

Validation failures use HTTP 422; authentication failures 401; forbidden access 403; missing records 404; duplicates or invalid state conflicts 409.

## REST API

Base path: `/api/v1`.

### Auth and business

| Method | Route | Purpose |
|---|---|---|
| POST | `/auth/register` | Register owner; optional business fields create a business and default templates |
| POST | `/auth/login` | Login with phone/password |
| GET | `/auth/me` | Current user and business |
| GET | `/business/me` | Current business profile |
| POST | `/business` | Create current owner's business |
| PATCH | `/business/:id` | Update business |

### Customers, services, and staff

| Resource | Routes |
|---|---|
| Customers | `GET/POST /customers`, `GET/PATCH/DELETE /customers/:id`, `GET /customers/search?query=`, `GET /customers/by-phone/:phone` |
| Services | `GET/POST /services`, `GET/PATCH/DELETE /services/:id` (`isActive` activates/deactivates) |
| Staff | `GET/POST /staff`, `GET/PATCH/DELETE /staff/:id`, `PATCH /staff/:id/status` |

### Queue

| Method | Route | Purpose |
|---|---|---|
| GET | `/queue/today` | Today's ordered queue |
| GET | `/queue/summary` | Serving, next, counts, wait average, and estimated total |
| POST | `/queue` | Add customer with `customerId`, `serviceId`, optional `staffId`, `source`, `notes` |
| GET | `/queue/:id` | Entry, status history, notifications, and payments |
| PATCH | `/queue/:id/status` | Set a queue status |
| POST | `/queue/:id/start` | Start service and mark assigned staff busy |
| POST | `/queue/:id/complete` | Complete, increment visits, set last visit, free staff |
| POST | `/queue/:id/cancel` | Cancel entry |
| POST | `/queue/:id/no-show` | Mark no-show and increment customer count |
| POST | `/queue/:id/move-up` | Move waiting entry up |
| POST | `/queue/:id/move-down` | Move waiting entry down |
| POST | `/queue/:id/notify-next` | Create NEXT_CUSTOMER preview for the next waiting customer |

Queue numbers and estimated start/wait times are recalculated after additions, status changes, and reordering.

### Appointments and communication

| Resource | Routes |
|---|---|
| Appointments | `GET/POST /appointments`, `GET/PATCH/DELETE /appointments/:id`, `POST /appointments/:id/reschedule`, `POST /appointments/:id/add-to-queue`; filter with `?date=YYYY-MM-DD` |
| Templates | `GET/POST /message-templates`, `PATCH/DELETE /message-templates/:id`, `POST /message-templates/:id/render` |
| Notifications | `GET/POST /notifications`, `POST /notifications/queue/:queueEntryId/notify`, `PATCH /notifications/:id/sent` |

Template rendering accepts `{ "variables": { "customer_name": "..." } }`. Unknown variables remain visible in braces. Notifications are preview records only; this MVP does not contact SMS or WhatsApp providers.

### Public customer booking

These routes are intentionally outside the JWT middleware and use the standard
`{ "success": true, "message": "...", "data": { ... } }` envelope.

| Method | Route | Behavior |
|---|---|---|
| GET | `/public/businesses?query=` | Approved, active businesses with public fields and active services; name/city/address search |
| GET | `/public/businesses/:id` | Public booking details, active services, and bookable staff (staff phones are blank) |
| POST | `/public/appointments` | Transactional customer upsert and appointment booking; service duration controls `endTime` |
| GET | `/public/appointments?phone=` | Phone-linked, customer-safe appointment summaries, upcoming first |

Public booking normalizes Ethiopian mobile numbers to `+2517XXXXXXXX` or
`+2519XXXXXXXX`, rejects past and overlapping staff bookings, and rate-limits
both IP addresses and normalized phone numbers. Appointment lookups pass through
`authorizeCustomerLookup` in `src/services/public-booking.service.js`; replace
that policy with short-lived OTP-token verification before exposing this route
to untrusted production traffic. The Flutter client would then need an OTP
request/verify screen and send the resulting customer bearer token instead of a
bare `phone` query.

### Payments and reports

| Resource | Routes |
|---|---|
| Payments | `GET/POST /payments`, `GET/PATCH/DELETE /payments/:id`, `GET /payments/summary/today` |
| Reports | `GET /reports/dashboard`, `/reports/revenue`, `/reports/queue`, `/reports/customers`, `/reports/staff` |

Recording a `PAID` payment updates customer spending. Reports aggregate paid revenue, queue metrics, popular services, staff completions, and payment methods.

## Socket.IO

Connect to the same host/port and send the JWT as handshake auth:

```js
const socket = io('http://localhost:8000', { auth: { token } });
socket.emit('join_business', businessId);
```

The server only permits the authenticated user's room: `business:{businessId}`.

Client events: `join_business`, `leave_business`.

Server events: `queue_updated`, `queue_summary_updated`, `customer_added_to_queue`, `queue_status_changed`, `appointment_created`, `payment_recorded`, `notification_created`.

```json
{
  "businessId": "uuid",
  "event": "queue_updated",
  "data": { "queue": [], "summary": {} }
}
```

## Database and seed

The initial migration is in `prisma/migrations/202606200001_init`. Public booking
support is added by `prisma/migrations/202608060001_public_booking` and
`prisma/migrations/202608060002_public_search_indexes`; deploy them with
`npm run db:deploy` before starting the updated API. They add business lifecycle
flags, normalized customer phones, appointment sources, and public
catalog/scheduling indexes. No new environment variables are required.

The repeatable seed replaces its demo owner's business and creates BK Barber, two staff, four services, three customers, today's queue, one appointment, and seven Amharic templates.
