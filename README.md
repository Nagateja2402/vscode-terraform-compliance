# Terraform Compliance Assistant – Hackweek 2025

Embed **AI-driven compliance intelligence** into the developer workflow, enabling secure and compliant Terraform code **by default**.

---

## Vision

Proactively guide developers to write secure, compliant Terraform configurations **inside the VSCode IDE**, eliminating late-stage surprises and security risks.

---

## Problem Statement

As Terraform adoption scales, enforcing compliance during infrastructure provisioning becomes harder. Current approaches:

- Provide compliance feedback **too late** (plan/apply phase).
- **Lack context** for developers writing code.
- Require **security expertise**, creating bottlenecks.

**This leads to:**
- Misconfigurations
- Delayed remediation
- Increased risk exposure

---

## Persona: Developer

> *"I want to author secure, compliant Terraform code without slowing down delivery or becoming a security expert."*

---

## Jobs To Be Done

- When writing `.tf` code in my IDE,  
  I want **real-time compliance feedback** based on baseline/org controls,  
  So that I can **fix issues early** and prevent misconfigurations.

- **When fixing compliance issues**,  
  I want **AI-suggested fixes aligned to baseline policies**,  
  So that **security is built-in** by default.

---

## Critical User Journey

**As a developer**, I want to:
- Receive **inline compliance feedback** aligned with baseline controls
- Get **AI-suggested fixes and rationale**
- Remediate directly in the IDE before committing/provisioning infrastructure

---

## Business Outcomes

- **Accelerated Delivery**: Shift compliance left to enable secure development
- **Lower Risk**: Prevent misconfigurations and breaches early
- **Compliance at Scale**: Enforce consistent policies across all teams/projects

---

## Proposed Solution

Introducing the **Terraform Compliance Assistant**:  
An AI-powered VSCode extension that provides **inline compliance intelligence** and **code remediations** while authoring `.tf` files.

Powered by:
- **Amazon Bedrock**: Leverages Llama/Claude models
- **Sentinel**: Uses existing OOTB policies aligned with FSBP Compliance Standard as baseline controls
- **Terraform Registry**: Context-aware metadata on resource configuration

### Features

- Real-time analysis of `.tf` resource and data blocks
- AI-driven fix suggestions and code corrections
- Explanations with compliance rationale (educational)
- Continuous compliance feedback loop in the developer workflow

---

## Requirements

- Build a **VSCode extension** for `.tf` file authoring
- Integrate with **Amazon Bedrock** using:
  - Llama and Claude models (ensure all models enabled)
  - FSBP Sentinel policies and controls as prompt base
  - Terraform Registry metadata for resource awareness
- Use **Doormat AWS account** to access Bedrock models:

---

## Use Cases

| Use Case | Description |
|----------|-------------|
| Real-time Scan | Analyze `.tf` file for compliance violations |
| AI Suggestions | Auto-suggest code changes based on FSBP controls |
| Explain & Educate | Provide rationale for each fix suggestion |
| IDE Integration | Native experience in VSCode while authoring Terraform code |

---

## AI Model Usage

- **Models**: Llama2 / Claude (via Bedrock)
- **Prompt Context**:
  - Sentinel OOTB Policy Snippets (FSBP)
  - Resource metadata from Terraform Registry
  - Compliance mapping examples
- **Response**: Suggest secure, compliant Terraform block or parameter

---
## Feedback / Ideas

Have suggestions or want to contribute?
Please open an issue or start a discussion.
---
