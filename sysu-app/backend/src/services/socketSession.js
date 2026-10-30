/** Revalidate established Auth sessions every 30 seconds; fail closed after 5 seconds. */
function watchSocketSession(socket, token, verify, clock = {setTimeout, clearTimeout}) {
    let stopped = false, nextCheck, deadline;
    const stop = () => {
        stopped = true;
        clock.clearTimeout(nextCheck);
        clock.clearTimeout(deadline);
    };
    const deny = () => {if (!stopped) {stop(); socket.disconnect(true);}};
    const check = () => {
        if (stopped) return;
        deadline = clock.setTimeout(deny, 5000);
        deadline?.unref?.();
        Promise.resolve().then(() => verify(token)).then(decoded => {
            if (stopped) return;
            if (decoded?.uid !== socket.data.uid || !Number.isFinite(decoded?.exp)
                || decoded.exp * 1000 <= Date.now()) {deny(); return;}
            clock.clearTimeout(deadline);
            schedule();
        }).catch(deny);
    };
    const schedule = () => {
        nextCheck = clock.setTimeout(check, 30000);
        nextCheck?.unref?.();
    };
    socket.once('disconnect', stop);
    schedule();
    return stop;
}
module.exports = {watchSocketSession};
