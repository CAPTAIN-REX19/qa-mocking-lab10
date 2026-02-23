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
});