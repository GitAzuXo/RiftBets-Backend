import passport from "passport";
import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
import dotenv from "dotenv";
dotenv.config();

const options = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET || "default"
};

passport.use(
  new JwtStrategy(options, (jwt_payload, done) => {
    const user = { username: jwt_payload.username };
    if (user) return done(null, user);
    else return done(null, false);
  })
);

export default passport;
