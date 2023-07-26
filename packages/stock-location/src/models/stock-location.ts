import {
  BeforeCreate,
  Entity,
  Index,
  ManyToOne,
  OptionalProps,
  PrimaryKey,
  Property,
} from "@mikro-orm/core"

import { StockLocationAddress } from "./stock-location-address"
import { generateEntityId } from "@medusajs/utils"

type OptionalFields = "created_at" | "updated_at"

@Entity({ tableName: "stock_location" })
export class StockLocation {
  [OptionalProps]?: OptionalFields

  @PrimaryKey({ columnType: "text" })
  id: string

  @Property({
    onCreate: () => new Date(),
    columnType: "timestamptz",
  })
  created_at: Date

  @Property({
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
    columnType: "timestamptz",
  })
  updated_at: Date

  @Property({ columnType: "timestamptz", nullable: true })
  deleted_at: Date | null

  @Property({ columnType: "text" })
  name: string

  @Index()
  @Property({ columnType: "text", nullable: true })
  address_id: string | null

  @ManyToOne(() => StockLocationAddress, {
    nullable: true,
    fieldName: "address_id",
  })
  address?: StockLocationAddress | null

  @Property({ columnType: "jsonb", nullable: true })
  metadata: Record<string, unknown> | null

  @BeforeCreate()
  private beforeCreate(): void {
    this.id = generateEntityId(this.id, "sloc")
  }
}

export default StockLocation
