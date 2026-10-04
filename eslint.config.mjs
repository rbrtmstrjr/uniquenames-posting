import next from "eslint-config-next";

const config = [...next, { ignores: ["worker/**", ".next/**", "node_modules/**"] }];
export default config;
