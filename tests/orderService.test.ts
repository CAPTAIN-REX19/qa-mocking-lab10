import { OrderService, PaymentClient, EmailClient } from "../src/orderService";

describe("OrderService", () => {
    test("creates order and sends confirmation email on approved payment (happy path)", async () => {
        const paymentClient: PaymentClient = {
            charge: jest.fn().mockResolvedValue({ status: "approved", transactionId: "tx_123" }),
        };

        const emailClient: EmailClient = {
            send: jest.fn().mockResolvedValue(undefined),
        };

        const service = new OrderService(paymentClient, emailClient);

        const result = await service.createOrder({
            userEmail: "  USER@Example.com ",
            currency: "USD",
            items: [
                { sku: "A-1", qty: 2, price: 10.0 }, // $20
            ],
            couponCode: null,
        });

        expect(result.order.userEmail).toBe("user@example.com");
        expect(result.payment.status).toBe("approved");

        // charge called
        expect(paymentClient.charge).toHaveBeenCalledTimes(1);
        const [amountCents, currency, orderId] = (paymentClient.charge as jest.Mock).mock.calls[0];
        expect(currency).toBe("USD");
        expect(typeof orderId).toBe("string");
        expect(orderId.startsWith("ord_")).toBe(true);

        // email called
        expect(emailClient.send).toHaveBeenCalledTimes(1);
        const [to, subject, body] = (emailClient.send as jest.Mock).mock.calls[0];
        expect(to).toBe("user@example.com");
        expect(subject).toContain("confirmed");
        expect(body).toContain("Total:");
    });

    test("throws validation error for empty items", async () => {
        const paymentClient: PaymentClient = {
            charge: jest.fn(),
        };
        const emailClient: EmailClient = {
            send: jest.fn(),
        };

        const service = new OrderService(paymentClient, emailClient);

        await expect(
            service.createOrder({
                userEmail: "test@example.com",
                currency: "USD",
                items: [],
            })
        ).rejects.toThrow("VALIDATION: empty items");

        expect(paymentClient.charge).not.toHaveBeenCalled();
        expect(emailClient.send).not.toHaveBeenCalled();
    });

    test("throws error when payment is declined", async () => {
        const paymentClient: PaymentClient = {
            charge: jest.fn().mockResolvedValue({ status: "declined", declineReason: "some interesting reason", transactionId: "tx_123" }),
        };

        const emailClient: EmailClient = {
            send: jest.fn(),
        };

        const service = new OrderService(paymentClient, emailClient);

        await expect(service.createOrder({
            userEmail: "USER@Example.com",
            currency: "USD",
            items: [
                { sku: "A-1", qty: 2, price: 10.0 }, // $20
            ],
            couponCode: null,
        })).rejects.toThrow("PAYMENT_DECLINED: some interesting reason");


        // charge called
        expect(paymentClient.charge).toHaveBeenCalledTimes(1);
        expect(emailClient.send).not.toHaveBeenCalled();
    });

    test("validation: invalid price", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn() };
        const emailClient: EmailClient = { send: jest.fn() };

        const service = new OrderService(paymentClient, emailClient);

        await expect(service.createOrder({
            userEmail: "test@example.com",
            currency: "USD",
            items: [{ sku: "A", qty: 1, price: -5 }],
        })).rejects.toThrow("VALIDATION: invalid price");

        expect(paymentClient.charge).not.toHaveBeenCalled();
        expect(emailClient.send).not.toHaveBeenCalled();
    });

    test("validation: invalid sku (empty)", async () => {
        const payment: PaymentClient = { charge: jest.fn() };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(payment, emailClient);

        await expect(service.createOrder({
            userEmail: "test@example.com",
            currency: "USD",
            items: [{ sku: "", qty: 1, price: 10 }],
        })).rejects.toThrow("VALIDATION: invalid sku");
    });

    test("validation: invalid qty (0)", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn() };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(paymentClient, emailClient);

        await expect(service.createOrder({
            userEmail: "test@example.com",
            currency: "USD",
            items: [{ sku: "A", qty: 0, price: 10 }],
        })).rejects.toThrow("VALIDATION: invalid qty");
    });

    test("validation: invalid qty (negative)", async () => {
        const payment: PaymentClient = { charge: jest.fn() };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(payment, emailClient);

        await expect(service.createOrder({
            userEmail: "test@example.com",
            currency: "USD",
            items: [{ sku: "A", qty: -1, price: 10 }],
        })).rejects.toThrow("VALIDATION: invalid qty");
    });

    test("validation: invalid qty (not integer)", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn() };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(paymentClient, emailClient);

        await expect(service.createOrder({
            userEmail: "test@example.com",
            currency: "USD",
            items: [{ sku: "A", qty: 1.5, price: 10 }],
        })).rejects.toThrow("VALIDATION: invalid qty");
    });

    test("throws error when email is invalid", async () => {
        const paymentClient: PaymentClient = {
            charge: jest.fn(),
        };

        const emailClient: EmailClient = {
            send: jest.fn(),
        };

        const service = new OrderService(paymentClient, emailClient);

        await expect(service.createOrder({
            userEmail: "USERExample.com",
            currency: "USD",
            items: [
                { sku: "A-1", qty: 2, price: 10.0 },
            ],
            couponCode: null,
        })).rejects.toThrow("VALIDATION: invalid email");

        expect(paymentClient.charge).not.toHaveBeenCalled();
        expect(emailClient.send).not.toHaveBeenCalled();
    });

    test("discount: SAVE10 (10%) + email call = 1", async () => {
        const paymentClient: PaymentClient = {
            charge: jest.fn().mockResolvedValue({ status: "approved" }),
        };
        const emailClient: EmailClient = { send: jest.fn() };

        const service = new OrderService(paymentClient, emailClient);

        await service.createOrder({
            userEmail: "a@b.com",
            currency: "USD",
            items: [{ sku: "A", qty: 2, price: 50 }],
            couponCode: "SAVE10",
        });

        const [amount] = (paymentClient.charge as jest.Mock).mock.calls[0];
        expect(amount).toBe(9743);

        expect(paymentClient.charge).toHaveBeenCalled();
        expect(emailClient.send).toHaveBeenCalledTimes(1);
    });

    test("discount: SAVE20 (20%)", async () => {
        const paymentClient: PaymentClient = {
            charge: jest.fn().mockResolvedValue({ status: "approved" }),
        };
        const emailClient: EmailClient = { send: jest.fn() };

        const service = new OrderService(paymentClient, emailClient);

        await service.createOrder({
            userEmail: "a@b.com",
            currency: "USD",
            items: [{ sku: "A", qty: 1, price: 100 }],
            couponCode: "SAVE20",
        });

        const [amount] = (paymentClient.charge as jest.Mock).mock.calls[0];
        expect(amount).toBe(8660);

        expect(paymentClient.charge).toHaveBeenCalled();
        expect(emailClient.send).toHaveBeenCalled();
    });

    test("discount: FREESHIP", async () => {
        const paymentClient: PaymentClient = {
            charge: jest.fn().mockResolvedValue({ status: "approved" }),
        };
        const emailClient: EmailClient = { send: jest.fn() };

        const service = new OrderService(paymentClient, emailClient);

        await service.createOrder({
            userEmail: "a@b.com",
            currency: "USD",
            items: [{ sku: "A", qty: 2, price: 80 }],
            couponCode: "FREESHIP",
        });

        const [amount] = (paymentClient.charge as jest.Mock).mock.calls[0];
        expect(amount).toBe(17320);
    });

    test("coupon: WELCOME (5% max $15)", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn().mockResolvedValue({ status: "approved" }) };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(paymentClient, emailClient);

        await service.createOrder({
            userEmail: "a@b.com",
            currency: "USD",
            items: [{ sku: "A", qty: 10, price: 100 }],
            couponCode: "WELCOME2025",
        });

        const [amount] = (paymentClient.charge as jest.Mock).mock.calls[0];
        expect(amount).toBe(106626);
    });

    test("discount: unknown coupon throws error", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn() };
        const emailClient: EmailClient = { send: jest.fn() };

        const service = new OrderService(paymentClient, emailClient);

        await expect(service.createOrder({
            userEmail: "a@b.com",
            currency: "USD",
            items: [{ sku: "A", qty: 1, price: 10 }],
            couponCode: "UNKNOWN",
        })).rejects.toThrow("VALIDATION: unknown coupon");

        expect(paymentClient.charge).not.toHaveBeenCalled();
        expect(emailClient.send).not.toHaveBeenCalled();
    });

    test("shipping: free when subtotal >= 5000", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn().mockResolvedValue({ status: "approved" }) };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(paymentClient, emailClient);

        await service.createOrder({
            userEmail: "a@b.com",
            currency: "USD",
            items: [{ sku: "A", qty: 1, price: 60 }],
        });

        const [amount] = (paymentClient.charge as jest.Mock).mock.calls[0];
        expect(amount).toBe(6495);

        expect(emailClient.send).toHaveBeenCalledTimes(1);
    });

    test("shipping: paid when subtotal < 5000", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn().mockResolvedValue({ status: "approved" }) };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(paymentClient, emailClient);

        await service.createOrder({
            userEmail: "a@b.com",
            currency: "USD",
            items: [{ sku: "A", qty: 1, price: 10 }],
        });

        const [amount] = (paymentClient.charge as jest.Mock).mock.calls[0];
        expect(amount).toBe(1882);
    });

    test("shipping: USD vs EUR difference", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn().mockResolvedValue({ status: "approved" }) };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(paymentClient, emailClient);

        await service.createOrder({
            userEmail: "a@b.com",
            currency: "EUR",
            items: [{ sku: "A", qty: 1, price: 10 }],
        });

        const [amount] = (paymentClient.charge as jest.Mock).mock.calls[0];
        expect(amount).toBe(1899);
    });

    test("tax: EUR uses VAT 20%", async () => {
        const paymentClient: PaymentClient = {
            charge: jest.fn().mockResolvedValue({ status: "approved" }),
        };
        const emailClient: EmailClient = { send: jest.fn() };

        const service = new OrderService(paymentClient, emailClient);

        await service.createOrder({
            userEmail: "a@b.com",
            currency: "EUR",
            items: [{ sku: "A", qty: 1, price: 10 }],
        });

        const [amount] = (paymentClient.charge as jest.Mock).mock.calls[0];
        expect(amount).toBe(1899);
    });

    test("risk: tempmail domain", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn() };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(paymentClient, emailClient);

        await expect(service.createOrder({
            userEmail: "user@tempmail.com",
            currency: "USD",
            items: [{ sku: "A", qty: 1, price: 10 }],
        })).rejects.toThrow("RISK: tempmail is not allowed");
    });

    test("risk: amount > 200000 cents", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn().mockResolvedValue({ status: "approved" }) };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(paymentClient, emailClient);

        await expect(service.createOrder({
            userEmail: "big@shop.com",
            currency: "USD",
            items: [{ sku: "BIG", qty: 1, price: 3000 }], // $3000
        })).rejects.toThrow("RISK: amount too high");
    });

    test("risk: plus alias with high amount", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn() };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(paymentClient, emailClient);

        await expect(service.createOrder({
            userEmail: "user+alias@example.com",
            currency: "USD",
            items: [{ sku: "BIG", qty: 1, price: 1000 }], // $1000
        })).rejects.toThrow("RISK: plus-alias high amount");
    });

    test("edge: rounding cents (10.005)", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn().mockResolvedValue({ status: "approved" }) };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(paymentClient, emailClient);

        await service.createOrder({
            userEmail: "a@b.com",
            currency: "USD",
            items: [{ sku: "A", qty: 1, price: 10.005 }],
        });

        const [amount] = (paymentClient.charge as jest.Mock).mock.calls[0];
        expect(amount).toBe(1883);
    });

    test("edge: multiple items subtotal", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn().mockResolvedValue({ status: "approved" }) };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(paymentClient, emailClient);

        await service.createOrder({
            userEmail: "a@b.com",
            currency: "USD",
            items: [
                { sku: "A", qty: 1, price: 10 },
                { sku: "B", qty: 2, price: 20 },
            ],
        });

        const [amount] = (paymentClient.charge as jest.Mock).mock.calls[0];
        expect(amount).toBe(5413);
    });

    test("edge: total never negative", async () => {
        const paymentClient: PaymentClient = { charge: jest.fn().mockResolvedValue({ status: "approved" }) };
        const emailClient: EmailClient = { send: jest.fn() };
        const service = new OrderService(paymentClient, emailClient);

        await service.createOrder({
            userEmail: "a@b.com",
            currency: "USD",
            items: [{ sku: "A", qty: 1, price: 1 }],
            couponCode: "SAVE20",
        });

        const [amount] = (paymentClient.charge as jest.Mock).mock.calls[0];
        expect(amount).toBeGreaterThanOrEqual(0);
    });
});