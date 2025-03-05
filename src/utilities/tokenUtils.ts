export interface JwtPayload {
    exp?: number;
    iat?: number;
    user?: string;
    [key: string]: any;
}

export function parseJwt(token: string): JwtPayload {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));

        return JSON.parse(jsonPayload);
    } catch (error) {
        console.error('Error parsing JWT:', error);
        return {};
    }
}

export function isTokenExpired(token: string): boolean {
    try {
        const payload = parseJwt(token);
        if (!payload.exp) return true;
        
        // exp is in seconds, Date.now() is in milliseconds
        const now = Date.now() / 1000;
        return payload.exp < now;
    } catch (error) {
        console.error('Error checking token expiration:', error);
        return true;
    }
} 