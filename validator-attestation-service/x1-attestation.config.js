module.exports = {
  apps: [
    {
      name: "x1-attestation",
      script: "node",
      args: "-r ts-node/register index.ts",
      cwd: "/home/owl/x1bridge/validator-attestation-service",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        PORT: 8080
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      time: true
    }
  ]
};
