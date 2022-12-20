import {
  TransactionOrchestrator,
  TransactionStepsDefinition,
  TransactionHandlerType,
  TransactionPayload,
  TransactionState,
} from "../../transaction"

describe("Transaction Orchestrator", () => {
  it("Should follow the flow by calling steps in order with the correct payload", async () => {
    const mocks = {
      one: jest.fn().mockImplementation((payload) => {
        return payload
      }),
      two: jest.fn().mockImplementation((payload) => {
        return payload
      }),
    }

    async function handler(
      actionId: string,
      functionHandlerType: TransactionHandlerType,
      payload: TransactionPayload
    ) {
      const command = {
        firstMethod: {
          [TransactionHandlerType.INVOKE]: () => {
            mocks.one(payload)
          },
        },
        secondMethod: {
          [TransactionHandlerType.INVOKE]: () => {
            mocks.two(payload)
          },
        },
      }
      return command[actionId][functionHandlerType](payload)
    }

    const flow: TransactionStepsDefinition = {
      next: {
        action: "firstMethod",
        next: {
          action: "secondMethod",
        },
      },
    }

    const strategy = new TransactionOrchestrator("transaction-name", flow)

    const transaction = await strategy.beginTransaction(
      "idempotency_key_123",
      handler,
      {
        prop: 123,
      }
    )

    await strategy.resume(transaction)

    expect(transaction.idempotencyKey).toBe("idempotency_key_123")
    expect(transaction.getState()).toBe(TransactionState.DONE)

    expect(mocks.one).toBeCalledWith(
      expect.objectContaining({
        metadata: {
          producer: "transaction-name",
          reply_to_topic: "trans:transaction-name",
          idempotency_key: "idempotency_key_123:firstMethod:invoke",
          action: "firstMethod",
          action_type: "invoke",
          attempt: 1,
          timestamp: expect.any(Number),
        },
        data: { prop: 123 },
      })
    )

    expect(mocks.two).toBeCalledWith(
      expect.objectContaining({
        metadata: {
          producer: "transaction-name",
          reply_to_topic: "trans:transaction-name",
          idempotency_key: "idempotency_key_123:secondMethod:invoke",
          action: "secondMethod",
          action_type: "invoke",
          attempt: 1,
          timestamp: expect.any(Number),
        },
        data: { prop: 123 },
      })
    )
  })

  it("Should run steps in parallel if 'next' is an array", async () => {
    const actionOrder: string[] = []
    async function handler(
      actionId: string,
      functionHandlerType: TransactionHandlerType,
      payload: TransactionPayload
    ) {
      return actionOrder.push(actionId)
    }

    const flow: TransactionStepsDefinition = {
      next: [
        {
          action: "one",
        },
        {
          action: "two",
          next: {
            action: "four",
            next: {
              action: "six",
            },
          },
        },
        {
          action: "three",
          next: {
            action: "five",
          },
        },
      ],
    }

    const strategy = new TransactionOrchestrator("transaction-name", flow)

    const transaction = await strategy.beginTransaction(
      "idempotency_key_123",
      handler
    )

    await strategy.resume(transaction)
    expect(actionOrder).toEqual(["one", "two", "three", "four", "five", "six"])
  })

  it("Should not execute next steps when a step fails", async () => {
    const actionOrder: string[] = []
    async function handler(
      actionId: string,
      functionHandlerType: TransactionHandlerType,
      payload: TransactionPayload
    ) {
      if (functionHandlerType === TransactionHandlerType.INVOKE) {
        actionOrder.push(actionId)
      }

      if (TransactionHandlerType.INVOKE && actionId === "three") {
        throw new Error()
      }
    }

    const flow: TransactionStepsDefinition = {
      next: [
        {
          action: "one",
        },
        {
          action: "two",
          next: {
            action: "four",
            next: {
              action: "six",
            },
          },
        },
        {
          action: "three",
          maxRetries: 0,
          next: {
            action: "five",
          },
        },
      ],
    }

    const strategy = new TransactionOrchestrator("transaction-name", flow)

    const transaction = await strategy.beginTransaction(
      "idempotency_key_123",
      handler
    )

    await strategy.resume(transaction)
    expect(actionOrder).toEqual(["one", "two", "three"])
  })

  it("Should forward step response if flag 'forwardResponse' is set to true", async () => {
    const mocks = {
      one: jest.fn().mockImplementation((data) => {
        return { abc: 1234 }
      }),
      two: jest.fn().mockImplementation((data) => {
        return { def: "567" }
      }),
      three: jest.fn().mockImplementation((data) => {
        return { end: true }
      }),
    }

    async function handler(
      actionId: string,
      functionHandlerType: TransactionHandlerType,
      payload: TransactionPayload
    ) {
      const command = {
        firstMethod: {
          [TransactionHandlerType.INVOKE]: (data) => {
            return mocks.one(data)
          },
        },
        secondMethod: {
          [TransactionHandlerType.INVOKE]: (data) => {
            return mocks.two(data)
          },
        },
        thirdMethod: {
          [TransactionHandlerType.INVOKE]: (data) => {
            return mocks.three(data)
          },
        },
      }

      return command[actionId][functionHandlerType]({ ...payload.data })
    }

    const flow: TransactionStepsDefinition = {
      next: {
        action: "firstMethod",
        forwardResponse: true,
        next: {
          action: "secondMethod",
          forwardResponse: true,
          next: {
            action: "thirdMethod",
          },
        },
      },
    }

    const strategy = new TransactionOrchestrator("transaction-name", flow)

    const transaction = await strategy.beginTransaction(
      "idempotency_key_123",
      handler,
      {
        prop: 123,
      }
    )

    await strategy.resume(transaction)

    expect(mocks.one).toBeCalledWith({ prop: 123 })

    expect(mocks.two).toBeCalledWith({ prop: 123, _response: { abc: 1234 } })

    expect(mocks.three).toBeCalledWith({ prop: 123, _response: { def: "567" } })
  })

  it("Should continue the exection of next steps without waiting for the execution of all its parents when flag 'noWait' is set to true", async () => {
    const actionOrder: string[] = []
    async function handler(
      actionId: string,
      functionHandlerType: TransactionHandlerType,
      payload: TransactionPayload
    ) {
      if (functionHandlerType === TransactionHandlerType.INVOKE) {
        actionOrder.push(actionId)
      }

      if (
        functionHandlerType === TransactionHandlerType.INVOKE &&
        actionId === "three"
      ) {
        throw new Error()
      }
    }

    const flow: TransactionStepsDefinition = {
      next: [
        {
          action: "one",
          next: {
            action: "five",
          },
        },
        {
          action: "two",
          noWait: true,
          next: {
            action: "four",
          },
        },
        {
          action: "three",
          maxRetries: 0,
        },
      ],
    }

    const strategy = new TransactionOrchestrator("transaction-name", flow)

    const transaction = await strategy.beginTransaction(
      "idempotency_key_123",
      handler
    )

    strategy.resume(transaction)

    await new Promise((ok) => {
      strategy.on("finish", ok)
    })

    expect(actionOrder).toEqual(["one", "two", "three", "four"])
  })

  it("Should retry steps X times when a step fails and compensate steps afterward", async () => {
    const mocks = {
      one: jest.fn().mockImplementation((payload) => {
        return payload
      }),
      compensateOne: jest.fn().mockImplementation((payload) => {
        return payload
      }),
      two: jest.fn().mockImplementation((payload) => {
        throw new Error()
      }),
      compensateTwo: jest.fn().mockImplementation((payload) => {
        return payload
      }),
    }

    async function handler(
      actionId: string,
      functionHandlerType: TransactionHandlerType,
      payload: TransactionPayload
    ) {
      const command = {
        firstMethod: {
          [TransactionHandlerType.INVOKE]: () => {
            mocks.one(payload)
          },
          [TransactionHandlerType.COMPENSATE]: () => {
            mocks.compensateOne(payload)
          },
        },
        secondMethod: {
          [TransactionHandlerType.INVOKE]: () => {
            mocks.two(payload)
          },
          [TransactionHandlerType.COMPENSATE]: () => {
            mocks.compensateTwo(payload)
          },
        },
      }

      return command[actionId][functionHandlerType](payload)
    }

    const flow: TransactionStepsDefinition = {
      next: {
        action: "firstMethod",
        next: {
          action: "secondMethod",
        },
      },
    }

    const strategy = new TransactionOrchestrator("transaction-name", flow)

    const transaction = await strategy.beginTransaction(
      "idempotency_key_123",
      handler
    )

    await strategy.resume(transaction)

    expect(transaction.idempotencyKey).toBe("idempotency_key_123")
    expect(mocks.one).toBeCalledTimes(1)
    expect(mocks.two).toBeCalledTimes(1 + strategy.DEFAULT_RETRIES)
    expect(transaction.getState()).toBe(TransactionState.REVERTED)
    expect(mocks.compensateOne).toBeCalledTimes(1)

    expect(mocks.two).nthCalledWith(
      1,
      expect.objectContaining({
        metadata: expect.objectContaining({
          attempt: 1,
        }),
      })
    )

    expect(mocks.two).nthCalledWith(
      4,
      expect.objectContaining({
        metadata: expect.objectContaining({
          attempt: 4,
        }),
      })
    )
  })

  it("Should fail a transaction if any step fails after retrying X time to compensate it", async () => {
    const mocks = {
      one: jest.fn().mockImplementation((payload) => {
        throw new Error()
      }),
    }

    async function handler(
      actionId: string,
      functionHandlerType: TransactionHandlerType,
      payload: TransactionPayload
    ) {
      const command = {
        firstMethod: {
          [TransactionHandlerType.INVOKE]: () => {
            mocks.one(payload)
          },
        },
      }

      return command[actionId][functionHandlerType](payload)
    }

    const flow: TransactionStepsDefinition = {
      next: {
        action: "firstMethod",
      },
    }

    const strategy = new TransactionOrchestrator("transaction-name", flow)

    const transaction = await strategy.beginTransaction(
      "idempotency_key_123",
      handler
    )

    await strategy.resume(transaction)

    expect(mocks.one).toBeCalledTimes(1 + strategy.DEFAULT_RETRIES)
    expect(transaction.getState()).toBe(TransactionState.FAILED)
  })

  it("Should complete a transaction if a failing step has the flag 'continueOnPermanentFailure' set to true", async () => {
    const mocks = {
      one: jest.fn().mockImplementation((payload) => {
        return
      }),
      two: jest.fn().mockImplementation((payload) => {
        throw new Error()
      }),
    }

    async function handler(
      actionId: string,
      functionHandlerType: TransactionHandlerType,
      payload: TransactionPayload
    ) {
      const command = {
        firstMethod: {
          [TransactionHandlerType.INVOKE]: () => {
            mocks.one(payload)
          },
        },
        secondMethod: {
          [TransactionHandlerType.INVOKE]: () => {
            mocks.two(payload)
          },
        },
      }

      return command[actionId][functionHandlerType](payload)
    }

    const flow: TransactionStepsDefinition = {
      next: {
        action: "firstMethod",
        next: {
          action: "secondMethod",
          maxRetries: 1,
          continueOnPermanentFailure: true,
        },
      },
    }

    const strategy = new TransactionOrchestrator("transaction-name", flow)

    const transaction = await strategy.beginTransaction(
      "idempotency_key_123",
      handler
    )

    await strategy.resume(transaction)

    expect(transaction.idempotencyKey).toBe("idempotency_key_123")
    expect(mocks.one).toBeCalledTimes(1)
    expect(mocks.two).toBeCalledTimes(2)
    expect(transaction.getState()).toBe(TransactionState.DONE)
    expect(transaction.isPartiallyCompleted).toBe(true)
  })

  it("Should hold the status INVOKING while the transaction hasn't finished", async () => {
    const mocks = {
      one: jest.fn().mockImplementation((payload) => {
        return
      }),
      two: jest.fn().mockImplementation((payload) => {
        return
      }),
    }

    async function handler(
      actionId: string,
      functionHandlerType: TransactionHandlerType,
      payload: TransactionPayload
    ) {
      const command = {
        firstMethod: {
          [TransactionHandlerType.INVOKE]: () => {
            mocks.one(payload)
          },
        },
        secondMethod: {
          [TransactionHandlerType.INVOKE]: () => {
            mocks.two(payload)
          },
        },
      }

      return command[actionId][functionHandlerType](payload)
    }

    const flow: TransactionStepsDefinition = {
      next: {
        action: "firstMethod",
        async: true,
        next: {
          action: "secondMethod",
        },
      },
    }

    const strategy = new TransactionOrchestrator("transaction-name", flow)

    const transaction = await strategy.beginTransaction(
      "idempotency_key_123",
      handler
    )

    await strategy.resume(transaction)

    expect(mocks.one).toBeCalledTimes(1)
    expect(mocks.two).toBeCalledTimes(0)
    expect(transaction.getState()).toBe(TransactionState.INVOKING)

    const mockIdempotencyKey = TransactionOrchestrator.getKeyName(
      transaction.idempotencyKey,
      "firstMethod",
      TransactionHandlerType.INVOKE
    )
    await strategy.registerStepSuccess(
      mockIdempotencyKey,
      undefined,
      transaction
    )

    expect(transaction.getState()).toBe(TransactionState.DONE)
  })

  it("Should hold the status COMPENSATING while the transaction hasn't finished compensating", async () => {
    const mocks = {
      one: jest.fn().mockImplementation((payload) => {
        return
      }),
      compensateOne: jest.fn().mockImplementation((payload) => {
        return
      }),
      two: jest.fn().mockImplementation((payload) => {
        return
      }),
    }

    async function handler(
      actionId: string,
      functionHandlerType: TransactionHandlerType,
      payload: TransactionPayload
    ) {
      const command = {
        firstMethod: {
          [TransactionHandlerType.INVOKE]: () => {
            mocks.one(payload)
          },
          [TransactionHandlerType.COMPENSATE]: () => {
            mocks.compensateOne(payload)
          },
        },
        secondMethod: {
          [TransactionHandlerType.INVOKE]: () => {
            mocks.two(payload)
          },
        },
      }

      return command[actionId][functionHandlerType](payload)
    }

    const flow: TransactionStepsDefinition = {
      next: {
        action: "firstMethod",
        async: true,
        next: {
          action: "secondMethod",
        },
      },
    }

    const strategy = new TransactionOrchestrator("transaction-name", flow)

    const transaction = await strategy.beginTransaction(
      "idempotency_key_123",
      handler
    )

    const mockIdempotencyKey = TransactionOrchestrator.getKeyName(
      transaction.idempotencyKey,
      "firstMethod",
      TransactionHandlerType.INVOKE
    )

    const registerBeforeAllowed = await strategy
      .registerStepFailure(mockIdempotencyKey, handler)
      .catch((e) => e.message)

    await strategy.resume(transaction)

    expect(mocks.one).toBeCalledTimes(1)
    expect(mocks.compensateOne).toBeCalledTimes(0)
    expect(mocks.two).toBeCalledTimes(0)
    expect(registerBeforeAllowed).toEqual(
      "Cannot set step failure when status is idle"
    )
    expect(transaction.getState()).toBe(TransactionState.INVOKING)

    const resumedTransaction = await strategy.registerStepFailure(
      mockIdempotencyKey,
      handler
    )

    expect(resumedTransaction.getState()).toBe(TransactionState.COMPENSATING)
    expect(mocks.compensateOne).toBeCalledTimes(1)

    const mockIdempotencyKeyCompensate = TransactionOrchestrator.getKeyName(
      transaction.idempotencyKey,
      "firstMethod",
      TransactionHandlerType.COMPENSATE
    )
    await strategy.registerStepSuccess(
      mockIdempotencyKeyCompensate,
      undefined,
      resumedTransaction
    )

    expect(resumedTransaction.getState()).toBe(TransactionState.REVERTED)
  })
})
