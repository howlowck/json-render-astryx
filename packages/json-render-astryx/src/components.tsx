import type { ComponentProps, ReactNode } from "react";
import type { BaseComponentProps } from "@json-render/react";
import { useBoundProp } from "@json-render/react";

import { Stack } from "@astryxdesign/core/Stack";
import { Grid } from "@astryxdesign/core/Grid";
import { Section } from "@astryxdesign/core/Section";
import { Divider } from "@astryxdesign/core/Divider";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Link } from "@astryxdesign/core/Link";
import { Avatar } from "@astryxdesign/core/Avatar";
import { TextInput } from "@astryxdesign/core/TextInput";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@astryxdesign/core/Table";

type Option = { label: string; value: string };

/**
 * React registry implementations for the curated Astryx component set.
 * Each entry is a json-render `BaseComponentProps` render function that maps the
 * resolved spec props onto the real Astryx component. Pass individual entries to
 * `defineRegistry`.
 */
export const astryxComponents = {
  Stack: ({
    props,
    children,
  }: BaseComponentProps<{
    direction?: "horizontal" | "vertical";
    gap?: number;
    padding?: number;
  }>): ReactNode => (
    <Stack
      direction={props.direction}
      gap={props.gap as ComponentProps<typeof Stack>["gap"]}
      padding={props.padding as ComponentProps<typeof Stack>["padding"]}
    >
      {children}
    </Stack>
  ),

  Grid: ({
    props,
    children,
  }: BaseComponentProps<{ columns?: number; gap?: number }>): ReactNode => (
    <Grid
      columns={props.columns}
      gap={props.gap as ComponentProps<typeof Grid>["gap"]}
    >
      {children}
    </Grid>
  ),

  Section: ({
    props,
    children,
  }: BaseComponentProps<{
    variant?: "section" | "transparent" | "muted";
    padding?: number;
  }>): ReactNode => (
    <Section
      variant={props.variant}
      padding={props.padding as ComponentProps<typeof Section>["padding"]}
    >
      {children}
    </Section>
  ),

  Divider: ({
    props,
  }: BaseComponentProps<{
    orientation?: "horizontal" | "vertical";
    label?: string;
    variant?: "subtle" | "strong";
  }>): ReactNode => (
    <Divider
      orientation={props.orientation}
      label={props.label}
      variant={props.variant}
    />
  ),

  Card: ({
    props,
    children,
  }: BaseComponentProps<{ variant?: string; padding?: number }>): ReactNode => (
    <Card
      variant={props.variant as ComponentProps<typeof Card>["variant"]}
      padding={props.padding as ComponentProps<typeof Card>["padding"]}
    >
      {children}
    </Card>
  ),

  Heading: ({
    props,
  }: BaseComponentProps<{
    level: number;
    text: string;
  }>): ReactNode => (
    <Heading level={props.level as ComponentProps<typeof Heading>["level"]}>
      {props.text}
    </Heading>
  ),

  Text: ({
    props,
  }: BaseComponentProps<{
    text: string;
    size?: string;
    weight?: string;
  }>): ReactNode => (
    <Text
      size={props.size as ComponentProps<typeof Text>["size"]}
      weight={props.weight as ComponentProps<typeof Text>["weight"]}
    >
      {props.text}
    </Text>
  ),

  Badge: ({
    props,
  }: BaseComponentProps<{ label: string; variant?: string }>): ReactNode => (
    <Badge
      label={props.label}
      variant={props.variant as ComponentProps<typeof Badge>["variant"]}
    />
  ),

  Button: ({
    props,
    emit,
  }: BaseComponentProps<{
    label: string;
    variant?: "primary" | "secondary" | "ghost" | "destructive";
    size?: "sm" | "md" | "lg";
  }>): ReactNode => (
    <Button
      label={props.label}
      variant={props.variant}
      size={props.size}
      onClick={() => emit("press")}
    />
  ),

  Link: ({
    props,
  }: BaseComponentProps<{ text: string; href: string }>): ReactNode => (
    <Link href={props.href}>{props.text}</Link>
  ),

  TextInput: ({
    props,
    bindings,
  }: BaseComponentProps<{
    label: string;
    value: string;
    placeholder?: string;
  }>): ReactNode => {
    const [value, setValue] = useBoundProp<string>(props.value, bindings?.value);
    return (
      <TextInput
        label={props.label}
        placeholder={props.placeholder}
        value={value ?? ""}
        onChange={(next) => setValue(next)}
      />
    );
  },

  NumberInput: ({
    props,
    bindings,
  }: BaseComponentProps<{ label: string; value: number | null }>): ReactNode => {
    const [value, setValue] = useBoundProp<number | null>(
      props.value,
      bindings?.value,
    );
    return (
      <NumberInput
        label={props.label}
        value={value ?? null}
        onChange={(next) => setValue(next)}
      />
    );
  },

  Checkbox: ({
    props,
    bindings,
  }: BaseComponentProps<{ label: string; value: boolean }>): ReactNode => {
    const [value, setValue] = useBoundProp<boolean>(
      props.value,
      bindings?.value,
    );
    return (
      <CheckboxInput
        label={props.label}
        value={value ?? false}
        onChange={(checked) => setValue(checked)}
      />
    );
  },

  RadioList: ({
    props,
    bindings,
  }: BaseComponentProps<{
    label: string;
    value: string;
    options: Option[];
  }>): ReactNode => {
    const [value, setValue] = useBoundProp<string>(props.value, bindings?.value);
    return (
      <RadioList
        label={props.label}
        value={value ?? ""}
        onChange={(next) => setValue(next)}
      >
        {props.options.map((option) => (
          <RadioListItem
            key={option.value}
            label={option.label}
            value={option.value}
          />
        ))}
      </RadioList>
    );
  },

  Selector: ({
    props,
    bindings,
  }: BaseComponentProps<{
    label: string;
    value: string;
    options: Option[];
  }>): ReactNode => {
    const [value, setValue] = useBoundProp<string>(props.value, bindings?.value);
    return (
      <Selector
        label={props.label}
        options={props.options}
        value={value ?? ""}
        onChange={(next) => setValue(next)}
      />
    );
  },

  Switch: ({
    props,
    bindings,
  }: BaseComponentProps<{ label: string; value: boolean }>): ReactNode => {
    const [value, setValue] = useBoundProp<boolean>(
      props.value,
      bindings?.value,
    );
    return (
      <Switch
        label={props.label}
        value={value ?? false}
        onChange={(checked) => setValue(checked)}
      />
    );
  },

  Table: ({
    props,
  }: BaseComponentProps<{
    columns: Array<{ key: string; header: string }>;
    rows: Array<Record<string, unknown>>;
  }>): ReactNode => (
    <Table>
      <TableHeader>
        <TableRow isHeaderRow>
          {props.columns.map((column) => (
            <TableHeaderCell key={column.key}>{column.header}</TableHeaderCell>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.rows.map((row, index) => (
          <TableRow key={index}>
            {props.columns.map((column) => (
              <TableCell key={column.key}>
                {String(row[column.key] ?? "")}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),

  Avatar: ({
    props,
  }: BaseComponentProps<{
    name?: string;
    src?: string;
    size?: string;
  }>): ReactNode => (
    <Avatar
      name={props.name}
      src={props.src}
      size={props.size as ComponentProps<typeof Avatar>["size"]}
    />
  ),
};
