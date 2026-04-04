using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CleanSweep.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddDeletedAtToMediaItem : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "deleted_at",
                table: "media_items",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "deleted_at",
                table: "media_items");
        }
    }
}
