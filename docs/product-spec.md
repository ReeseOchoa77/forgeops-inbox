# Product
Unified Inbox + Task Extraction Platform

## Core idea
A multi-tenant web app where each client has a workspace.
Each workspace can connect multiple Gmail inboxes.
The app ingests email, classifies it, extracts tasks/action requests, and shows everything in a dashboard.

## V1 features
- Sign in
- Create workspace
- Add Gmail inbox
- Sync recent messages
- Classify email type
- Extract summary, company, project, deadline
- Detect tasks/action requests
- Push inbox items and tasks to dashboard
- Open source thread in Gmail

## Email categories
- RFQ / Bid Invite
- Vendor Quote
- Shipping / Delivery
- Recruiting / Applicant
- Internal Project Communication
- Admin / Finance
- Misc / Needs Review

## Extracted fields
- subject
- sender_name
- sender_email
- company_name
- project_name
- deadline
- priority
- recommended_owner
- summary
- contains_action_request
- task_title
- task_description
- task_due_date
- confidence