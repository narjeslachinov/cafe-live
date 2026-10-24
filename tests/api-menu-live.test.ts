/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from "vitest";
import { countWhere, createRestaurant, type Fixture } from "./helpers/db";
import { login, openStream, sleep, waitUntil, type Api, type SseEvent } from "./helpers/http";

let F: Fixture, G: Fixture;
let manager: Api, waiter: Api, otherWaiter: Api;

const cursorOf = async (who: Api) => (await who.call("GET", "/api/kitchen/queue")).json.cursor as number;
const menuEvents = (s: { events: SseEvent[] }) =>
  s.events.filter((e) => e.data.type === "menu_changed");

beforeAll(async () => {
  [F, G] = await Promise.all([createRestaurant("mlive-a"), createRestaurant("mlive-b")]);
  [manager, waiter, otherWaiter] = await Promise.all([
    login(F.email.manager), login(F.email.waiter), login(G.email.waiter),
  ]);
});

describe("menu changes reach the waiters", () => {
  it("announces each real change once, never to another restaurant, and the waiter then sees the new menu", async () => {
    const stream = await openStream(waiter.cookie, await cursorOf(waiter));
    const other = await openStream(otherWaiter.cookie, await cursorOf(otherWaiter));
    const price = 260000;

    await manager.call("POST", `/api/manage/menu-items/${F.menu.cake.id}`, { price_toman: price });
    await waitUntil(() => menuEvents(stream).length === 1);

    await manager.call("POST", `/api/manage/menu-items/${F.menu.cake.id}`, { is_available: false });
    await waitUntil(() => menuEvents(stream).length === 2);

    const batch = { items: [{ category: "Drinks", name: "Mocha live", price_toman: 195000 }] };
    expect((await manager.call("POST", "/api/manage/menu-import/commit", batch)).json.created).toBe(1);
    await waitUntil(() => menuEvents(stream).length === 3);

    // Saving the same things again changes nothing, so it announces nothing.
    await manager.call("POST", `/api/manage/menu-items/${F.menu.cake.id}`, { price_toman: price });
    await manager.call("POST", "/api/manage/menu-import/commit", batch);
    await sleep(2500);
    expect(menuEvents(stream)).toHaveLength(3);
    expect(menuEvents(stream)[0].data.orderId).toBeNull();
    expect(other.events).toHaveLength(0);

    const names = (await waiter.call("GET", "/api/menu")).json.categories.flatMap((c: any) => c.items.map((i: any) => i.name));
    expect(names).toContain("Mocha live");
    expect(names).not.toContain("Cheesecake");

    // Every change is on record with who made it.
    expect(
      await countWhere(
        "SELECT count(*)::int AS n FROM order_events WHERE restaurant_id = $1 AND type = 'menu_changed' AND actor_id = $2",
        [F.id, F.userIds.manager],
      ),
    ).toBe(3);

    stream.close();
    other.close();
  });
});