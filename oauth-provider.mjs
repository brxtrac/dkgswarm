import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { isRedirectAllowed, randomToken, resolveRefreshScopes } from "./oauth.mjs";

export function createOAuthProvider({ store, mcpUrl, writerCredentialsActive }) {
  const resourceUrl = String(mcpUrl);
  const accessTtl = 3600;
  const refreshTtl = 30 * 24 * 3600;

  function issueTokens(clientId, scopes, resource, writerGrantId = null, tokenFamilyId = randomToken()) {
    const access = randomToken();
    const refresh = randomToken();
    const common = { clientId, scopes, resource, writerGrantId, tokenFamilyId };
    store.putToken(access, { ...common, type: "access", expiresAt: Date.now() + accessTtl * 1000 });
    store.putToken(refresh, { ...common, type: "refresh", expiresAt: Date.now() + refreshTtl * 1000 });
    return { access_token: access, token_type: "bearer", expires_in: accessTtl, scope: scopes.join(" "), refresh_token: refresh };
  }

  function authorizationCode(client, code) {
    const data = store.peekCode(code);
    if (!data || data.clientId !== client.client_id || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) {
      throw new InvalidGrantError("Invalid or expired authorization code");
    }
    return data;
  }

  return {
    clientsStore: store,
    async authorize(client, params, res) {
      if (!isRedirectAllowed(params.redirectUri) || !client.redirect_uris?.includes(params.redirectUri)) {
        throw new InvalidGrantError("redirect_uri is not allowed or registered");
      }
      const code = randomToken();
      store.putCode(code, {
        clientId: client.client_id, redirectUri: params.redirectUri, codeChallenge: params.codeChallenge,
        scopes: ["dkg:read"], writerGrantId: null, resource: params.resource?.href,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      const target = new URL(params.redirectUri);
      target.searchParams.set("code", code);
      if (params.state) target.searchParams.set("state", params.state);
      res.redirect(302, target.toString());
    },
    async challengeForAuthorizationCode(client, code) {
      return authorizationCode(client, code).codeChallenge;
    },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
      const data = authorizationCode(client, code);
      if (redirectUri !== data.redirectUri || !isRedirectAllowed(data.redirectUri)) throw new InvalidGrantError("redirect_uri mismatch or disallowed");
      if (data.resource !== resourceUrl || (resource && resource.href !== data.resource)) throw new InvalidGrantError("Token resource mismatch");
      if (!writerCredentialsActive(data)) throw new InvalidGrantError("Writer grant revoked");
      const consumed = store.takeCode(code);
      if (!consumed) throw new InvalidGrantError("Invalid authorization code");
      return issueTokens(client.client_id, consumed.scopes, consumed.resource, consumed.writerGrantId);
    },
    async exchangeRefreshToken(client, refreshToken, scopes, resource) {
      const data = store.getToken(refreshToken);
      if (!data || data.type !== "refresh" || data.clientId !== client.client_id || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) {
        throw new InvalidGrantError("Invalid or expired refresh token");
      }
      if (data.resource !== resourceUrl || (resource && resource.href !== data.resource)) throw new InvalidGrantError("Token resource mismatch");
      if (!writerCredentialsActive(data)) throw new InvalidGrantError("Writer grant revoked");
      if (scopes !== undefined && (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string" || !scope))) {
        throw new InvalidGrantError("Invalid scope parameter");
      }
      const requestedScopes = resolveRefreshScopes(data.scopes, scopes);
      const narrowed = data.scopes.includes("dkg:write") && !requestedScopes.includes("dkg:write");
      store.deleteToken(refreshToken);
      return issueTokens(client.client_id, requestedScopes, data.resource,
        requestedScopes.includes("dkg:write") ? data.writerGrantId : null,
        narrowed ? undefined : data.tokenFamilyId);
    },
    async verifyAccessToken(token) {
      const data = store.getToken(token);
      if (!data || data.type !== "access" || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) throw new InvalidTokenError("Invalid or expired token");
      if (data.resource !== resourceUrl) throw new InvalidTokenError("Token resource mismatch");
      if (!writerCredentialsActive(data)) throw new InvalidTokenError("Writer grant revoked");
      return { token, clientId: data.clientId, tokenFamilyId: data.tokenFamilyId, scopes: data.scopes,
        expiresAt: Math.floor(data.expiresAt / 1000), resource: data.resource };
    },
  };
}
