# OSS-Maintainer-AI

Production-grade Open Source AI Maintainer designed to automate workflows and assist open source project maintenance.

## Built With

OSS-Maintainer-AI is built on top of the [Caspian SDK](https://github.com/TryCaspian/caspian-sdk). Special thanks to the TryCaspian team for creating and maintaining the SDK that powers this project.

## Core Concepts

For an in depth review of project objectives, mission statement, and philosophy, please refer to our [Vision Document](docs/VISION.md).

For a complete architectural mapping of data flows and modules, review the [Architecture Document](docs/ARCHITECTURE.md).

## Getting Started

### Prerequisites
- Node.js (v18+)
- pnpm (v11+)

### Installation
```bash
# Clone the repository
git clone https://github.com/darkraider01/OSS-Maintainer-AI.git
cd OSS-Maintainer-AI

# Install dependencies
pnpm install
```

### Environment Configurations
Copy `.env.example` to `.env` and fill out your variables:
```bash
cp .env.example .env
```

### Running Locally
```bash
pnpm run dev
```

## Contributing
Please read [CONTRIBUTING.md](CONTRIBUTING.md) to understand how to format commits, style code, and review pull requests.

## License
Licensed under the [MIT License](LICENSE).
