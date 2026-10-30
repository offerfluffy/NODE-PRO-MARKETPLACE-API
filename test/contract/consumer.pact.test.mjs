import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert";
import { MatchersV3, PactV3 } from "@pact-foundation/pact";

const { regex } = MatchersV3;

const provider = new PactV3({
  dir: path.resolve(process.cwd(), "pacts"),
  consumer: "marketplace-web",
  provider: "marketplace-api",
});

const EXPECTED_BODY = {
  id: "1",
  customer_id: "3",
  status: "pending",
  total_cents: 24700,
  items: [
    {
      product_id: "1",
      quantity: 1,
      price_cents: 12900,
    },
    {
      product_id: "2",
      quantity: 2,
      price_cents: 5900,
    },
  ],
};

describe("GET /order/:id", () => {
  it("returns an HTTP 200 and order", async () => {
    provider
      .given("order with id 1 exists")
      .uponReceiving("a request for order 1")
      .withRequest({
        method: "GET",
        path: "/orders/1",
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: {
          "Content-Type": regex(
            /^application\/json(?:;\s*charset=utf-8)?$/i,
            "application/json",
          ),
        },
        body: EXPECTED_BODY,
      });

    await provider.executeTest(async (mockServer) => {
      const res = await fetch(mockServer.url + "/orders/1", {
        headers: { Accept: "application/json" },
      });

      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.id, "1");
      assert.equal(body.customer_id, "3");
      assert.equal(body.status, "pending");
      assert.equal(body.total_cents, 24700);
      assert.equal(body.items.length, 2);
      assert.deepEqual(body.items, EXPECTED_BODY.items);
    });
  });
});
